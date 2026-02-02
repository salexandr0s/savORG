import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import { PluginUnsupportedError } from '@/lib/repo/plugins'

/**
 * POST /api/plugins/restart
 * Queue a restart to apply plugin changes (danger level, requires approval)
 */
export async function POST(request: NextRequest) {
  // Get typed confirm from body
  let typedConfirmText: string | undefined
  try {
    const body = await request.json()
    typedConfirmText = body.typedConfirmText
  } catch {
    // Body might be empty
  }

  const repos = getRepos()

  // Find plugins that require restart
  const { data: allPlugins, meta: listMeta } = await repos.plugins.list()
  const pluginsNeedingRestart = allPlugins.filter((p) => p.restartRequired)

  if (pluginsNeedingRestart.length === 0) {
    return NextResponse.json(
      { error: 'No plugins require restart', meta: listMeta },
      { status: 400 }
    )
  }

  // Enforce Governor - plugin.restart is danger level
  const result = await enforceTypedConfirm({
    actionKind: 'plugin.restart',
    typedConfirmText,
  })

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.errorType,
        policy: result.policy,
      },
      { status: result.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
    )
  }

  // Create a receipt for the restart operation
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'plugin.restart',
    commandArgs: {
      pluginCount: pluginsNeedingRestart.length,
      pluginNames: pluginsNeedingRestart.map((p) => p.name),
    },
  })

  try {
    // Restart plugins via repo
    const { data: { pluginsRestarted }, meta } = await repos.plugins.restart()

    // Finalize receipt
    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 3000 + Math.random() * 2000, // Simulate 3-5s restart
      parsedJson: {
        status: 'restarted',
        pluginsRestarted,
        message: `Successfully restarted ${pluginsRestarted.length} plugin(s)`,
      },
    })

    // Log activity
    await repos.activities.create({
      type: 'plugin.restarted',
      actor: 'user',
      entityType: 'plugin',
      entityId: 'system',
      summary: `Restarted ${pluginsRestarted.length} plugin(s) to apply configuration changes`,
      payloadJson: {
        pluginsRestarted,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({
      data: {
        status: 'restarted',
        pluginsRestarted,
        message: `Successfully restarted ${pluginsRestarted.length} plugin(s)`,
      },
      meta,
      receiptId: receipt.id,
    })
  } catch (err) {
    // Handle unsupported operation
    if (err instanceof PluginUnsupportedError) {
      await repos.receipts.finalize(receipt.id, {
        exitCode: 1,
        durationMs: 100,
        parsedJson: {
          status: 'unsupported',
          error: err.message,
          operation: err.operation,
        },
      })

      return NextResponse.json(
        {
          error: err.code,
          message: err.message,
          operation: err.operation,
          capabilities: err.capabilities,
        },
        { status: err.httpStatus }
      )
    }
    throw err
  }
}
