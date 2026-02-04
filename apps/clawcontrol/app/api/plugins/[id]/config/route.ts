import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import { PluginUnsupportedError } from '@/lib/repo/plugins'
import Ajv from 'ajv'

const ajv = new Ajv({ allErrors: true, strict: false })

/**
 * Validate config against schema if available
 */
function validateConfig(
  config: Record<string, unknown>,
  schema: Record<string, unknown> | undefined
): { valid: boolean; errors?: string[] } {
  if (!schema) {
    // No schema, accept any config
    return { valid: true }
  }

  try {
    const validate = ajv.compile(schema)
    const valid = validate(config)

    if (!valid && validate.errors) {
      const errors = validate.errors.map((e) => {
        const path = e.instancePath || '(root)'
        return `${path}: ${e.message}`
      })
      return { valid: false, errors }
    }

    return { valid: true }
  } catch {
    return { valid: false, errors: ['Invalid schema'] }
  }
}

/**
 * PUT /api/plugins/:id/config
 * Update plugin configuration (danger level, requires approval)
 */
export async function PUT(
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
  const { config, typedConfirmText } = body

  if (!config || typeof config !== 'object') {
    return NextResponse.json(
      { error: 'Config must be a JSON object' },
      { status: 400 }
    )
  }

  // Validate against schema if available
  if (plugin.configSchema) {
    const validation = validateConfig(config, plugin.configSchema as unknown as Record<string, unknown>)
    if (!validation.valid) {
      return NextResponse.json(
        {
          error: 'CONFIG_VALIDATION_FAILED',
          message: 'Config does not match schema',
          validationErrors: validation.errors,
        },
        { status: 422 }
      )
    }
  }

  // Enforce Governor - plugin.edit_config is danger level
  const result = await enforceTypedConfirm({
    actionKind: 'plugin.edit_config',
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

  // Create a receipt for the config update
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'plugin.config_update',
    commandArgs: {
      pluginId: id,
      pluginName: plugin.name,
    },
  })

  try {
    // Update plugin config via repo
    const { data: updatedPlugin, meta } = await repos.plugins.update(id, { config })

    if (!updatedPlugin) {
      await repos.receipts.finalize(receipt.id, {
        exitCode: 1,
        durationMs: 100,
        parsedJson: {
          status: 'failed',
          error: 'Failed to update config',
        },
      })

      return NextResponse.json({ error: 'Failed to update plugin config', meta }, { status: 500 })
    }

    // Finalize receipt
    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 100 + Math.random() * 100,
      parsedJson: {
        pluginId: id,
        pluginName: plugin.name,
        status: 'config_updated',
        hasSchema: !!plugin.configSchema,
      },
    })

    // Log activity
    await repos.activities.create({
      type: 'plugin.config_updated',
      actor: 'user',
      entityType: 'plugin',
      entityId: id,
      summary: `Updated config for plugin: ${plugin.name}`,
      payloadJson: {
        pluginName: plugin.name,
        version: plugin.version,
        receiptId: receipt.id,
      },
    })

    // Get full plugin with updated config
    const { data: fullPlugin, meta: fullMeta } = await repos.plugins.getById(id)

    return NextResponse.json({
      data: fullPlugin,
      meta: fullMeta,
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
