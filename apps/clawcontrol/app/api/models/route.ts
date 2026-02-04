/**
 * Models API Route
 *
 * GET /api/models - List models and status
 * POST /api/models - Run model operations (list all, probe status)
 */

import { NextRequest, NextResponse } from 'next/server'
import { runCommand } from '@clawcontrol/adapters-openclaw'

// ============================================================================
// TYPES
// ============================================================================

interface ModelListItem {
  key: string
  name: string
  input: string
  contextWindow: number
  local: boolean
  available: boolean
  tags: string[]
  missing: boolean
}

interface _ModelListResponse {
  count: number
  models: ModelListItem[]
}

interface AuthProfile {
  profileId: string
  provider: string
  type: 'oauth' | 'token' | 'apiKey'
  status: 'ok' | 'expiring' | 'expired' | 'missing' | 'static'
  expiresAt?: number
  remainingMs?: number
  source: string
  label: string
}

interface ProviderAuth {
  provider: string
  status: 'ok' | 'expiring' | 'expired' | 'missing'
  profiles: AuthProfile[]
  expiresAt?: number
  remainingMs?: number
}

interface ModelStatusResponse {
  configPath: string
  agentDir: string
  defaultModel: string
  resolvedDefault: string
  fallbacks: string[]
  imageModel: string | null
  imageFallbacks: string[]
  aliases: Record<string, string>
  allowed: string[]
  auth: {
    storePath: string
    shellEnvFallback: {
      enabled: boolean
      appliedKeys: string[]
    }
    providersWithOAuth: string[]
    missingProvidersInUse: string[]
    providers: {
      provider: string
      effective: {
        kind: string
        detail: string
      }
      profiles: {
        count: number
        oauth: number
        token: number
        apiKey: number
        labels: string[]
      }
    }[]
    unusableProfiles: string[]
    oauth: {
      warnAfterMs: number
      profiles: AuthProfile[]
      providers: ProviderAuth[]
    }
  }
}

// ============================================================================
// GET - Get model status
// ============================================================================

export async function GET() {
  try {
    // Get model status
    const statusResult = await runCommand('models.status.json')

    if (statusResult.exitCode !== 0) {
      return NextResponse.json(
        { error: 'Failed to get model status', details: statusResult.stderr },
        { status: 500 }
      )
    }

    const status: ModelStatusResponse = JSON.parse(statusResult.stdout)

    return NextResponse.json({
      data: {
        status,
      },
    })
  } catch (err) {
    console.error('Models API error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

// ============================================================================
// POST - Run model operations
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body as { action: 'list' | 'list-all' | 'status' | 'probe' }

    let result
    switch (action) {
      case 'list':
        result = await runCommand('models.list.json')
        break
      case 'list-all':
        result = await runCommand('models.list.all.json')
        break
      case 'status':
        result = await runCommand('models.status.json')
        break
      case 'probe':
        result = await runCommand('models.status.probe.json')
        break
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        )
    }

    if (result.exitCode !== 0) {
      return NextResponse.json(
        { error: `Command failed: ${result.stderr}` },
        { status: 500 }
      )
    }

    const data = JSON.parse(result.stdout)

    return NextResponse.json({ data })
  } catch (err) {
    console.error('Models API POST error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
