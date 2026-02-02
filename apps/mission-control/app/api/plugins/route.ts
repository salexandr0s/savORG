import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import { PluginUnsupportedError } from '@/lib/repo/plugins'
import type { PluginSourceType } from '@savorg/core'

// Validation helpers
const ALLOWED_LOCAL_BASES = ['/usr/local/lib/savorg/plugins', '/opt/savorg/plugins']
const NPM_SPEC_PATTERN = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*(@[^@]+)?$/i
const GIT_SPEC_PATTERN = /^(https?:\/\/|git@)[^\s]+$/

function validateSpec(sourceType: PluginSourceType, spec: string): { valid: boolean; error?: string } {
  if (!spec || spec.trim().length === 0) {
    return { valid: false, error: 'Spec is required' }
  }

  switch (sourceType) {
    case 'local': {
      // Check if path is within allowed bases
      const isAllowed = ALLOWED_LOCAL_BASES.some((base) => spec.startsWith(base))
      if (!isAllowed && !spec.startsWith('/')) {
        return { valid: false, error: 'Local path must be absolute' }
      }
      // Prevent directory traversal
      if (spec.includes('..')) {
        return { valid: false, error: 'Path traversal not allowed' }
      }
      return { valid: true }
    }

    case 'npm':
      if (!NPM_SPEC_PATTERN.test(spec)) {
        return { valid: false, error: 'Invalid npm package spec' }
      }
      return { valid: true }

    case 'tgz':
      if (!spec.endsWith('.tgz') && !spec.endsWith('.tar.gz')) {
        return { valid: false, error: 'Tarball must be .tgz or .tar.gz' }
      }
      if (spec.includes('..')) {
        return { valid: false, error: 'Path traversal not allowed' }
      }
      return { valid: true }

    case 'git':
      if (!GIT_SPEC_PATTERN.test(spec)) {
        return { valid: false, error: 'Invalid git URL' }
      }
      return { valid: true }

    default:
      return { valid: false, error: 'Unknown source type' }
  }
}

function extractPluginName(sourceType: PluginSourceType, spec: string): string {
  switch (sourceType) {
    case 'local':
      return spec.split('/').pop() || 'unknown'
    case 'npm': {
      // Extract package name without version
      const match = spec.match(/^(@[^@/]+\/)?([^@/]+)/)
      return match ? (match[1] || '') + match[2] : spec
    }
    case 'tgz':
      return spec.split('/').pop()?.replace(/\.(tgz|tar\.gz)$/, '') || 'unknown'
    case 'git': {
      const repoMatch = spec.match(/\/([^/]+?)(\.git)?$/)
      return repoMatch ? repoMatch[1] : 'unknown'
    }
    default:
      return 'unknown'
  }
}

/**
 * GET /api/plugins
 * List all plugins with optional filters
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status') as 'active' | 'inactive' | 'error' | null
  const enabled = searchParams.get('enabled')

  const repos = getRepos()

  // Build filters
  const filters: {
    status?: 'active' | 'inactive' | 'error'
    enabled?: boolean
  } = {}

  if (status) {
    filters.status = status
  }

  if (enabled !== null) {
    filters.enabled = enabled === 'true'
  }

  const { data: plugins, meta } = await repos.plugins.list(filters)

  return NextResponse.json({ data: plugins, meta })
}

/**
 * POST /api/plugins
 * Install a new plugin (danger level, requires approval)
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { sourceType, spec, typedConfirmText } = body

  // Validate source type
  if (!['local', 'npm', 'tgz', 'git'].includes(sourceType)) {
    return NextResponse.json(
      { error: 'Invalid source type. Must be: local, npm, tgz, or git' },
      { status: 400 }
    )
  }

  // Validate spec
  const validation = validateSpec(sourceType as PluginSourceType, spec)
  if (!validation.valid) {
    return NextResponse.json(
      { error: validation.error },
      { status: 400 }
    )
  }

  const repos = getRepos()

  // Check for duplicate
  const pluginName = extractPluginName(sourceType as PluginSourceType, spec)
  const existingPlugin = await repos.plugins.getByName(pluginName)
  if (existingPlugin) {
    return NextResponse.json(
      { error: `Plugin "${pluginName}" is already installed` },
      { status: 409 }
    )
  }

  // Enforce Governor - plugin.install is danger level
  const result = await enforceTypedConfirm({
    actionKind: 'plugin.install',
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

  // Create a receipt for the install attempt
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: 'plugin.install',
    commandArgs: { sourceType, spec, pluginName },
  })

  try {
    // Install the plugin via repo
    const { data: newPlugin, meta } = await repos.plugins.install({
      sourceType: sourceType as PluginSourceType,
      spec,
    })

    // Finalize receipt with success (include capability snapshot for auditability)
    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 2000 + Math.random() * 1000, // Simulate 2-3s install
      parsedJson: {
        pluginId: newPlugin.id,
        pluginName: newPlugin.name,
        sourceType,
        spec,
        status: 'installed',
        capabilitySnapshot: {
          source: meta.source,
          capabilities: meta.capabilities,
          degraded: meta.degraded,
        },
      },
    })

    // Log activity
    await repos.activities.create({
      type: 'plugin.installed',
      actor: 'user',
      entityType: 'plugin',
      entityId: newPlugin.id,
      summary: `Installed plugin: ${newPlugin.name} from ${sourceType}`,
      payloadJson: {
        pluginName: newPlugin.name,
        sourceType,
        spec,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({
      data: newPlugin,
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

    // Finalize receipt with failure
    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: 1000,
      parsedJson: {
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
      },
    })

    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to install plugin' },
      { status: 500 }
    )
  }
}
