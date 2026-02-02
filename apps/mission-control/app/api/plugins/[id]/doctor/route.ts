import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import { PluginUnsupportedError } from '@/lib/repo/plugins'

/**
 * POST /api/plugins/:id/doctor
 * Run plugin diagnostics
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const repos = getRepos()

  const { data: plugin, meta: getMeta } = await repos.plugins.getById(id)
  if (!plugin) {
    return NextResponse.json({ error: 'Plugin not found', meta: getMeta }, { status: 404 })
  }

  // Get typed confirm from body
  let typedConfirmText: string | undefined
  try {
    const body = await request.json()
    typedConfirmText = body.typedConfirmText
  } catch {
    // Body might be empty
  }

  // Enforce Governor - plugin.doctor is caution level
  const result = await enforceTypedConfirm({
    actionKind: 'plugin.doctor',
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

  // Create a receipt for the doctor run
  const receipt = await repos.receipts.create({
    workOrderId: 'system', // Standalone operation not tied to a work order
    kind: 'manual',
    commandName: 'plugin.doctor',
    commandArgs: { pluginId: id, pluginName: plugin.name },
  })

  try {
    // Run doctor via repo
    const { data: doctorResult, meta } = await repos.plugins.doctor(id)

    // Finalize receipt (include capability snapshot for auditability)
    await repos.receipts.finalize(receipt.id, {
      exitCode: doctorResult.status === 'unhealthy' ? 1 : 0,
      durationMs: 1200 + Math.random() * 800, // Simulate 1.2-2s
      parsedJson: {
        checks: doctorResult.checks,
        status: doctorResult.status,
        summary: doctorResult.summary,
        capabilitySnapshot: {
          source: meta.source,
          capabilities: meta.capabilities,
          degraded: meta.degraded,
        },
      },
    })

    // Log activity
    await repos.activities.create({
      type: 'plugin.doctor_ran',
      actor: 'user',
      entityType: 'plugin',
      entityId: id,
      summary: `Ran doctor for plugin: ${plugin.name} (${doctorResult.status})`,
      payloadJson: {
        pluginName: plugin.name,
        version: plugin.version,
        status: doctorResult.status,
        checkCount: doctorResult.checks.length,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({
      data: {
        doctorResult: {
          ...doctorResult,
          receiptId: receipt.id,
        },
        receiptId: receipt.id,
      },
      meta,
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
