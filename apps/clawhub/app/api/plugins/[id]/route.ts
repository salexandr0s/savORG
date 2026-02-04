import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import { PluginUnsupportedError } from '@/lib/repo/plugins'
import type { ActionKind } from '@clawhub/core'

/**
 * GET /api/plugins/:id
 * Get plugin details with config
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const repos = getRepos()

  const { data: plugin, meta } = await repos.plugins.getById(id)
  if (!plugin) {
    return NextResponse.json({ error: 'Plugin not found', meta }, { status: 404 })
  }

  return NextResponse.json({ data: plugin, meta })
}

/**
 * PATCH /api/plugins/:id
 * Update plugin (enable/disable)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const repos = getRepos()

  const { data: plugin, meta: getMeta } = await repos.plugins.getById(id)
  if (!plugin) {
    return NextResponse.json({ error: 'Plugin not found', meta: getMeta }, { status: 404 })
  }

  const body = await request.json()
  const { enabled, typedConfirmText } = body

  // Determine action kind
  let actionKind: ActionKind = 'action.safe'
  if (typeof enabled === 'boolean') {
    actionKind = enabled ? 'plugin.enable' : 'plugin.disable'
  }

  // Enforce Governor
  const result = await enforceTypedConfirm({
    actionKind,
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

  try {
    // Update plugin via repo
    const { data: updatedPlugin, meta } = await repos.plugins.update(id, { enabled })
    if (!updatedPlugin) {
      return NextResponse.json({ error: 'Failed to update plugin', meta }, { status: 500 })
    }

    // Log activity
    if (typeof enabled === 'boolean') {
      await repos.activities.create({
        type: enabled ? 'plugin.enabled' : 'plugin.disabled',
        actor: 'user',
        entityType: 'plugin',
        entityId: id,
        summary: `${enabled ? 'Enabled' : 'Disabled'} plugin: ${plugin.name}`,
        payloadJson: {
          pluginName: plugin.name,
          version: plugin.version,
          enabled,
        },
      })
    }

    // Get full plugin with config
    const { data: fullPlugin, meta: fullMeta } = await repos.plugins.getById(id)

    return NextResponse.json({ data: fullPlugin, meta: fullMeta })
  } catch (err) {
    // Handle unsupported operation
    if (err instanceof PluginUnsupportedError) {
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

/**
 * DELETE /api/plugins/:id
 * Uninstall a plugin (danger level, requires approval)
 */
export async function DELETE(
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

  // Enforce Governor - plugin.uninstall is danger level
  const result = await enforceTypedConfirm({
    actionKind: 'plugin.uninstall',
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

  // Create a receipt for the uninstall attempt
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'plugin.uninstall',
    commandArgs: {
      pluginId: id,
      pluginName: plugin.name,
      version: plugin.version,
    },
  })

  try {
    // Uninstall plugin via repo
    const { success, meta } = await repos.plugins.uninstall(id)

    if (!success) {
      // Finalize receipt with failure
      await repos.receipts.finalize(receipt.id, {
        exitCode: 1,
        durationMs: 500,
        parsedJson: {
          pluginId: id,
          pluginName: plugin.name,
          status: 'failed',
          error: 'Uninstall not supported or failed',
        },
      })

      return NextResponse.json(
        { error: 'Failed to uninstall plugin', meta },
        { status: 500 }
      )
    }

    // Finalize receipt with success (include capability snapshot for auditability)
    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 1000 + Math.random() * 500, // Simulate 1-1.5s uninstall
      parsedJson: {
        pluginId: id,
        pluginName: plugin.name,
        status: 'removed',
        capabilitySnapshot: {
          source: meta.source,
          capabilities: meta.capabilities,
          degraded: meta.degraded,
        },
      },
    })

    // Log activity
    await repos.activities.create({
      type: 'plugin.removed',
      actor: 'user',
      entityType: 'plugin',
      entityId: id,
      summary: `Uninstalled plugin: ${plugin.name}`,
      payloadJson: {
        pluginName: plugin.name,
        version: plugin.version,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({
      success: true,
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
