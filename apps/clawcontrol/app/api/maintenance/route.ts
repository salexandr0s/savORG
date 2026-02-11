import { NextResponse } from 'next/server'
import { OPENCLAW_BIN, MIN_OPENCLAW_VERSION } from '@clawcontrol/adapters-openclaw'
import { getRepos } from '@/lib/repo'
import { getOpenClawConfig, getOpenClawConfigSync } from '@/lib/openclaw-client'
import { DEFAULT_GATEWAY_HTTP_URL } from '@/lib/settings/types'
import { getOpenClawRuntimeDependencyStatus } from '@/lib/openclaw/runtime-deps'

const CACHE_TTL_MS = 30_000

type MaintenanceResponseBody = {
  data: {
    mode: string
    localOnly: unknown
    cliBin: string
    resolvedCliBin: string
    cliAvailable: boolean
    cliVersion: string | null
    minVersion: string
    belowMinVersion?: boolean
    cliError?: string
    cliCheckedAt?: string | null
    health: {
      status: 'ok' | 'degraded' | 'down'
      message?: string
      timestamp: string
    }
    status: unknown
    probe: unknown
    pollIntervalMs: number
    timestamp: string
  }
}

let cached: { body: MaintenanceResponseBody; createdAtMs: number } | null = null
let inFlight: Promise<MaintenanceResponseBody> | null = null

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function parsePollIntervalMs(): number {
  const raw = process.env.MAINTENANCE_POLL_INTERVAL_MS
  if (!raw) return 30_000

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 30_000
  return parsed
}

function responseWithHeaders(body: MaintenanceResponseBody, cacheStatus: 'HIT' | 'MISS') {
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': `private, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`,
      'X-Cache': cacheStatus,
    },
  })
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (LOOPBACK_HOSTS.has(normalized)) return true
  return /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

function mapAvailabilityToHealthStatus(status: 'ok' | 'degraded' | 'unavailable'): 'ok' | 'degraded' | 'down' {
  if (status === 'unavailable') return 'down'
  return status
}

function buildLocalOnlySummary(gatewayUrl: string) {
  let bind: string | null = null
  let port: number | null = null
  let ok = false

  try {
    const parsed = new URL(gatewayUrl)
    bind = isLoopbackHostname(parsed.hostname) ? 'loopback' : parsed.hostname
    port = parsed.port ? Number.parseInt(parsed.port, 10) : null
    ok = bind === 'loopback'
  } catch {
    // Keep defaults when URL parsing fails.
  }

  return {
    clawcontrol: {
      expectedHost: '127.0.0.1',
      enforced: true,
    },
    openclawDashboard: {
      bind,
      port,
      ok,
    },
  }
}

/**
 * GET /api/maintenance
 * Get current gateway status and health
 *
 * Response includes CLI info:
 * - cliAvailable: boolean
 * - cliVersion: version string or null
 * - cliBin: 'openclaw' (constant)
 * - minVersion: minimum required version
 */
export async function GET() {
  const now = Date.now()
  if (cached && now - cached.createdAtMs < CACHE_TTL_MS) {
    return responseWithHeaders(cached.body, 'HIT')
  }

  if (!inFlight) {
    inFlight = (async (): Promise<MaintenanceResponseBody> => {
      // Check OpenClaw runtime dependency status
      const cliStatus = await getOpenClawRuntimeDependencyStatus()
      const pollIntervalMs = parsePollIntervalMs()

      try {
        const repos = getRepos()
        const [statusRes, resolvedConfig] = await Promise.all([
          repos.gateway.status(),
          getOpenClawConfig(true).catch(() => null),
        ])
        const statusData = statusRes.data ?? { running: false }
        const resolvedVersion = typeof statusData.version === 'string' && statusData.version.trim().length > 0
          ? statusData.version
          : (cliStatus.cliVersion ?? undefined)
        const statusPayload = {
          ...statusData,
          ...(resolvedVersion ? { version: resolvedVersion } : {}),
        }

        const fallbackConfig = resolvedConfig ?? getOpenClawConfigSync()
        const gatewayUrl = fallbackConfig?.gatewayUrl ?? DEFAULT_GATEWAY_HTTP_URL
        const localOnly = buildLocalOnlySummary(gatewayUrl)

        const body: MaintenanceResponseBody = {
          data: {
            mode: 'probe_first',
            localOnly,
            // CLI info
            cliBin: OPENCLAW_BIN,
            resolvedCliBin: cliStatus.resolvedCliBin,
            cliAvailable: cliStatus.cliAvailable,
            cliVersion: cliStatus.cliVersion,
            minVersion: MIN_OPENCLAW_VERSION,
            belowMinVersion: cliStatus.belowMinVersion,
            cliError: cliStatus.cliError,
            cliCheckedAt: cliStatus.checkedAt,
            // Gateway status (lean)
            health: {
              status: mapAvailabilityToHealthStatus(statusRes.status),
              message: statusRes.error ?? undefined,
              timestamp: statusRes.timestamp,
            },
            status: statusPayload,
            probe: {
              ok: statusRes.status !== 'unavailable',
              latencyMs: statusRes.latencyMs,
              ...(statusRes.error ? { error: statusRes.error } : {}),
            },
            pollIntervalMs,
            timestamp: statusRes.timestamp,
          },
        }

        return body
      } catch (err) {
        const body: MaintenanceResponseBody = {
          data: {
            mode: 'probe_first',
            // CLI info (even on error)
            cliBin: OPENCLAW_BIN,
            resolvedCliBin: cliStatus.resolvedCliBin,
            cliAvailable: cliStatus.cliAvailable,
            cliVersion: cliStatus.cliVersion,
            minVersion: MIN_OPENCLAW_VERSION,
            belowMinVersion: cliStatus.belowMinVersion,
            cliError: cliStatus.cliError,
            cliCheckedAt: cliStatus.checkedAt,
            // Error state
            localOnly: null,
            health: {
              status: 'down',
              message: err instanceof Error ? err.message : 'Failed to check health',
              timestamp: new Date().toISOString(),
            },
            status: { running: false },
            probe: { ok: false, latencyMs: 0 },
            pollIntervalMs,
            timestamp: new Date().toISOString(),
          },
        }

        return body
      }
    })()
      .then((body) => {
        cached = { body, createdAtMs: Date.now() }
        return body
      })
      .finally(() => {
        inFlight = null
      })
  }

  try {
    const body = await inFlight
    return responseWithHeaders(body, 'MISS')
  } catch (err) {
    const body: MaintenanceResponseBody = {
      data: {
        mode: 'unknown',
        localOnly: null,
        cliBin: OPENCLAW_BIN,
        resolvedCliBin: OPENCLAW_BIN,
        cliAvailable: false,
        cliVersion: null,
        minVersion: MIN_OPENCLAW_VERSION,
        health: {
          status: 'down',
          message: err instanceof Error ? err.message : 'Failed to check health',
          timestamp: new Date().toISOString(),
        },
        status: { running: false },
        probe: { ok: false, latencyMs: 0 },
        pollIntervalMs: parsePollIntervalMs(),
        timestamp: new Date().toISOString(),
      },
    }
    cached = { body, createdAtMs: Date.now() }
    return responseWithHeaders(body, 'MISS')
  }
}
