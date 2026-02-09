import { NextResponse } from 'next/server'
import { getOpenClawConfig } from '@/lib/openclaw-client'
import { readSettings, writeSettings } from '@/lib/settings/store'
import type { ClawcontrolSettings } from '@/lib/settings/types'
import { invalidateWorkspaceRootCache } from '@/lib/fs/path-policy'
import { validateWorkspaceStructure } from '@/lib/workspace/validate'

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false
  }
  return null
}

function applyRuntimeWorkspacePath(workspacePath: string | null | undefined): void {
  const normalized = normalizeString(workspacePath)

  if (normalized) {
    process.env.OPENCLAW_WORKSPACE = normalized
    process.env.CLAWCONTROL_WORKSPACE_ROOT = normalized
  } else {
    delete process.env.OPENCLAW_WORKSPACE
    delete process.env.CLAWCONTROL_WORKSPACE_ROOT
  }

  invalidateWorkspaceRootCache()
}

async function buildResponseData() {
  const settingsResult = await readSettings()
  const resolved = await getOpenClawConfig(true)

  const settings = settingsResult.settings
  const workspacePath = resolved?.workspacePath ?? settings.workspacePath ?? null
  const workspaceValidation = await validateWorkspaceStructure(workspacePath)

  return {
    settings: {
      gatewayHttpUrl: settings.gatewayHttpUrl ?? null,
      gatewayWsUrl: settings.gatewayWsUrl ?? null,
      gatewayToken: settings.gatewayToken ?? null,
      workspacePath: settings.workspacePath ?? null,
      setupCompleted: settings.setupCompleted ?? false,
      updatedAt: settings.updatedAt,
    },
    resolved: resolved
      ? {
          gatewayHttpUrl: resolved.gatewayUrl,
          gatewayWsUrl: resolved.gatewayWsUrl ?? null,
          gatewayTokenSource: resolved.resolution.tokenSource,
          workspacePath: resolved.workspacePath,
          source: resolved.source,
          configPath: resolved.configPath,
          configPaths: resolved.configPaths,
          gatewayUrlSource: resolved.resolution.gatewayUrlSource,
          gatewayWsUrlSource: resolved.resolution.gatewayWsUrlSource,
          workspaceSource: resolved.resolution.workspaceSource,
        }
      : null,
    settingsPath: settingsResult.path,
    legacyEnvPath: settingsResult.legacyEnvPath,
    migratedFromEnv: settingsResult.migratedFromEnv,
    workspaceValidation,
  }
}

export async function GET() {
  try {
    const data = await buildResponseData()
    return NextResponse.json({ data })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to load settings' },
      { status: 500 }
    )
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    const patch: Record<string, unknown> = {}

    if ('gatewayHttpUrl' in body) {
      patch.gatewayHttpUrl = normalizeString(body.gatewayHttpUrl)
    }

    if ('gatewayWsUrl' in body) {
      patch.gatewayWsUrl = normalizeString(body.gatewayWsUrl)
    }

    if ('gatewayToken' in body) {
      patch.gatewayToken = normalizeString(body.gatewayToken)
    }

    if ('workspacePath' in body) {
      patch.workspacePath = normalizeString(body.workspacePath)
    }

    if ('setupCompleted' in body) {
      const parsed = normalizeBoolean(body.setupCompleted)
      if (parsed === null) {
        return NextResponse.json(
          { error: 'setupCompleted must be a boolean' },
          { status: 400 }
        )
      }
      patch.setupCompleted = parsed
    }

    const saved = await writeSettings(patch as Partial<ClawcontrolSettings>)

    if ('workspacePath' in patch) {
      applyRuntimeWorkspacePath(saved.settings.workspacePath ?? null)
    }

    const data = await buildResponseData()

    return NextResponse.json({
      data,
      message: 'Settings saved successfully',
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to save settings' },
      { status: 500 }
    )
  }
}
