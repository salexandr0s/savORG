import 'server-only'

import {
  checkGatewayHealth,
  discoverLocalConfig,
  probeGatewayHealth,
  type DiscoveredConfig,
  type GatewayProbeStatus,
  type GatewayProbeState,
} from '@clawcontrol/adapters-openclaw'
import {
  readSettings,
  readSettingsSync,
} from '@/lib/settings/store'
import {
  DEFAULT_GATEWAY_HTTP_URL,
  DEFAULT_GATEWAY_WS_URL,
} from '@/lib/settings/types'

export interface ResolvedOpenClawConfig extends DiscoveredConfig {
  resolution: {
    gatewayUrlSource: 'settings' | 'env' | 'openclaw'
    gatewayWsUrlSource: 'settings' | 'env' | 'openclaw'
    tokenSource: 'settings' | 'env' | 'openclaw' | 'none'
    workspaceSource: 'settings' | 'env' | 'openclaw' | 'none'
  }
}

export interface GatewayRetryResult {
  available: boolean
  state: GatewayProbeState
  attempts: number
  probe: GatewayProbeStatus | null
}

let cachedConfig: ResolvedOpenClawConfig | null = null
let lastCheckMs = 0
const CACHE_TTL_MS = 60_000

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function toWsUrl(httpUrl: string): string {
  if (httpUrl.startsWith('https://')) return `wss://${httpUrl.slice('https://'.length)}`
  if (httpUrl.startsWith('http://')) return `ws://${httpUrl.slice('http://'.length)}`
  if (httpUrl.startsWith('ws://') || httpUrl.startsWith('wss://')) return httpUrl
  return `ws://${httpUrl}`
}

function hasMeaningfulSettings(config: {
  gatewayHttpUrl?: string
  gatewayWsUrl?: string
  gatewayToken?: string
  workspacePath?: string
}): boolean {
  return Boolean(
    normalizeString(config.gatewayHttpUrl)
    || normalizeString(config.gatewayWsUrl)
    || normalizeString(config.gatewayToken)
    || normalizeString(config.workspacePath)
  )
}

async function resolveConfig(): Promise<ResolvedOpenClawConfig | null> {
  const [discovered, settingsResult] = await Promise.all([
    discoverLocalConfig(),
    readSettings(),
  ])

  const settings = settingsResult.settings

  const envGatewayUrl = normalizeString(process.env.OPENCLAW_GATEWAY_HTTP_URL)
  const envGatewayWsUrl = normalizeString(process.env.OPENCLAW_GATEWAY_WS_URL)
  const envGatewayToken = normalizeString(process.env.OPENCLAW_GATEWAY_TOKEN)
  const envWorkspace = normalizeString(process.env.OPENCLAW_WORKSPACE)

  const settingsGatewayUrl = normalizeString(settings.gatewayHttpUrl)
  const settingsGatewayWsUrl = normalizeString(settings.gatewayWsUrl)
  const settingsGatewayToken = normalizeString(settings.gatewayToken)
  const settingsWorkspace = normalizeString(settings.workspacePath)

  const discoveredGatewayUrl = normalizeString(discovered?.gatewayUrl)
  const discoveredGatewayWsUrl = normalizeString(discovered?.gatewayWsUrl)
  const discoveredToken = normalizeString(discovered?.token)
  const discoveredWorkspace = normalizeString(discovered?.workspacePath)

  const hasSettings = hasMeaningfulSettings(settings)
  const hasEnv = Boolean(envGatewayUrl || envGatewayWsUrl || envGatewayToken || envWorkspace)
  if (!discovered && !hasSettings && !hasEnv) {
    return null
  }

  const gatewayUrl =
    settingsGatewayUrl
    || envGatewayUrl
    || discoveredGatewayUrl
    || DEFAULT_GATEWAY_HTTP_URL

  const gatewayWsUrl =
    settingsGatewayWsUrl
    || envGatewayWsUrl
    || discoveredGatewayWsUrl
    || toWsUrl(gatewayUrl)
    || DEFAULT_GATEWAY_WS_URL

  const token =
    settingsGatewayToken
    || envGatewayToken
    || discoveredToken
    || null

  const workspacePath =
    settingsWorkspace
    || envWorkspace
    || discoveredWorkspace
    || null

  const configPath =
    discovered?.configPath
    || settingsResult.path

  const configPaths = discovered?.configPaths ?? [settingsResult.path]

  return {
    gatewayUrl,
    gatewayWsUrl,
    token,
    workspacePath,
    agents: discovered?.agents ?? [],
    configPath,
    configPaths,
    source: discovered?.source ?? 'filesystem',
    resolution: {
      gatewayUrlSource:
        settingsGatewayUrl ? 'settings' : envGatewayUrl ? 'env' : 'openclaw',
      gatewayWsUrlSource:
        settingsGatewayWsUrl ? 'settings' : envGatewayWsUrl ? 'env' : 'openclaw',
      tokenSource:
        settingsGatewayToken
          ? 'settings'
          : envGatewayToken
            ? 'env'
            : discoveredToken
              ? 'openclaw'
              : 'none',
      workspaceSource:
        settingsWorkspace
          ? 'settings'
          : envWorkspace
            ? 'env'
            : discoveredWorkspace
              ? 'openclaw'
              : 'none',
    },
  }
}

export async function getOpenClawConfig(forceRefresh = false): Promise<ResolvedOpenClawConfig | null> {
  const now = Date.now()

  if (!forceRefresh && cachedConfig && (now - lastCheckMs) < CACHE_TTL_MS) {
    return cachedConfig
  }

  cachedConfig = await resolveConfig()
  lastCheckMs = now
  return cachedConfig
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitForGatewayAvailability(
  config: Pick<ResolvedOpenClawConfig, 'gatewayUrl' | 'token'>,
  retryDelaysMs: number[] = [0, 1000, 2000, 4000, 8000]
): Promise<GatewayRetryResult> {
  let lastProbe: GatewayProbeStatus | null = null

  for (let i = 0; i < retryDelaysMs.length; i += 1) {
    const delay = retryDelaysMs[i] ?? 0
    if (delay > 0) {
      await sleep(delay)
    }

    lastProbe = await probeGatewayHealth(config.gatewayUrl, config.token ?? undefined)
    if (lastProbe.ok || lastProbe.state === 'auth_required') {
      return {
        available: lastProbe.ok,
        state: lastProbe.state,
        attempts: i + 1,
        probe: lastProbe,
      }
    }
  }

  return {
    available: false,
    state: lastProbe?.state ?? 'unreachable',
    attempts: retryDelaysMs.length,
    probe: lastProbe,
  }
}

export async function isGatewayOnline(): Promise<boolean> {
  const config = await getOpenClawConfig()
  if (!config) return false
  return checkGatewayHealth(config.gatewayUrl, config.token ?? undefined)
}

export function getOpenClawConfigSync(): ResolvedOpenClawConfig | null {
  const settingsResult = readSettingsSync()
  const settings = settingsResult.settings

  const settingsGatewayUrl = normalizeString(settings.gatewayHttpUrl)
  const settingsGatewayWsUrl = normalizeString(settings.gatewayWsUrl)
  const settingsGatewayToken = normalizeString(settings.gatewayToken)
  const settingsWorkspace = normalizeString(settings.workspacePath)

  const envGatewayUrl = normalizeString(process.env.OPENCLAW_GATEWAY_HTTP_URL)
  const envGatewayWsUrl = normalizeString(process.env.OPENCLAW_GATEWAY_WS_URL)
  const envGatewayToken = normalizeString(process.env.OPENCLAW_GATEWAY_TOKEN)
  const envWorkspace = normalizeString(process.env.OPENCLAW_WORKSPACE)

  if (!hasMeaningfulSettings(settings) && !envGatewayUrl && !envGatewayWsUrl && !envGatewayToken && !envWorkspace) {
    return null
  }

  const gatewayUrl = settingsGatewayUrl || envGatewayUrl || DEFAULT_GATEWAY_HTTP_URL
  const gatewayWsUrl = settingsGatewayWsUrl || envGatewayWsUrl || toWsUrl(gatewayUrl)
  const token = settingsGatewayToken || envGatewayToken || null
  const workspacePath = settingsWorkspace || envWorkspace || null

  return {
    gatewayUrl,
    gatewayWsUrl,
    token,
    workspacePath,
    agents: [],
    configPath: settingsResult.path,
    configPaths: [settingsResult.path],
    source: 'filesystem',
    resolution: {
      gatewayUrlSource: settingsGatewayUrl ? 'settings' : envGatewayUrl ? 'env' : 'openclaw',
      gatewayWsUrlSource: settingsGatewayWsUrl ? 'settings' : envGatewayWsUrl ? 'env' : 'openclaw',
      tokenSource: settingsGatewayToken ? 'settings' : envGatewayToken ? 'env' : 'none',
      workspaceSource: settingsWorkspace ? 'settings' : envWorkspace ? 'env' : 'none',
    },
  }
}
