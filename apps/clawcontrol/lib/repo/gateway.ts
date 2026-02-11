/**
 * Gateway Repository
 *
 * Availability-aware repository for OpenClaw gateway operations.
 * Returns OpenClawResponse<T> with explicit ok|degraded|unavailable status.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  type GatewayProbeStatus,
  probeGatewayHealth,
  runCommandJson,
} from '@clawcontrol/adapters-openclaw'
import {
  type OpenClawResponse,
  type AvailabilityStatus,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  CACHE_TTL_MS,
} from '@/lib/openclaw/availability'
import {
  getOpenClawConfig,
  getOpenClawConfigSync,
} from '@/lib/openclaw-client'
import { DEFAULT_GATEWAY_HTTP_URL } from '@/lib/settings/types'

const execFileAsync = promisify(execFile)
const PROCESS_UPTIME_TIMEOUT_MS = 750

function parseStatusEnrichmentTimeoutMs(): number {
  const raw = process.env.OPENCLAW_GATEWAY_STATUS_JSON_TIMEOUT_MS
  if (!raw) return 2_500

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 2_500
  return parsed
}

const GATEWAY_STATUS_ENRICH_TIMEOUT_MS = parseStatusEnrichmentTimeoutMs()

// ============================================================================
// TYPES
// ============================================================================

export interface GatewayStatusDTO {
  running: boolean
  pid?: number
  uptime?: number
  version?: string
  connections?: {
    active: number
    idle: number
  }
  memory?: {
    heapUsed: number
    heapTotal: number
    rss: number
  }
}

export interface GatewayHealthDTO {
  healthy: boolean
  checks?: {
    name: string
    status: 'pass' | 'fail' | 'warn'
    message?: string
  }[]
}

export interface GatewayProbeDTO {
  reachable: boolean
  latencyMs: number
  error?: string
}

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface GatewayRepo {
  status(): Promise<OpenClawResponse<GatewayStatusDTO>>
  health(): Promise<OpenClawResponse<GatewayHealthDTO>>
  probe(): Promise<OpenClawResponse<GatewayProbeDTO>>
}

// ============================================================================
// IN-MEMORY CACHE
// ============================================================================

interface CacheEntry<T> {
  data: OpenClawResponse<T>
  cachedAt: number
}

const cache = new Map<string, CacheEntry<unknown>>()

function getCached<T>(key: string): OpenClawResponse<T> | null {
  const entry = cache.get(key) as CacheEntry<T> | undefined
  if (!entry) return null

  const age = Date.now() - entry.cachedAt
  if (age > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }

  return {
    ...entry.data,
    cached: true,
    staleAgeMs: age,
  }
}

function setCache<T>(key: string, response: OpenClawResponse<T>): void {
  cache.set(key, { data: response, cachedAt: Date.now() })
}

interface GatewayTarget {
  gatewayUrl: string
  token?: string
}

async function resolveGatewayTarget(): Promise<GatewayTarget> {
  try {
    const resolved = (await getOpenClawConfig(true)) ?? getOpenClawConfigSync()
    if (resolved) {
      return {
        gatewayUrl: resolved.gatewayUrl,
        token: resolved.token ?? undefined,
      }
    }
  } catch {
    const fallback = getOpenClawConfigSync()
    if (fallback) {
      return {
        gatewayUrl: fallback.gatewayUrl,
        token: fallback.token ?? undefined,
      }
    }
  }

  return { gatewayUrl: DEFAULT_GATEWAY_HTTP_URL }
}

function availabilityFromProbe(probe: GatewayProbeStatus, latencyMs: number): AvailabilityStatus {
  if (!probe.ok && probe.state !== 'auth_required') return 'unavailable'
  if (probe.state === 'auth_required') return 'degraded'
  return latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim()
  if (!trimmed) return undefined

  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function asNonNegativeInteger(value: unknown): number | undefined {
  const num = asNumber(value)
  if (num === undefined || num < 0) return undefined
  return Math.floor(num)
}

function firstNonEmptyString(values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return undefined
}

function parseElapsedPsTime(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  const [dayPart, clockPart] = trimmed.includes('-')
    ? trimmed.split('-', 2)
    : [null, trimmed]

  const segments = clockPart.split(':').map((segment) => Number.parseInt(segment, 10))
  if (segments.some((segment) => Number.isNaN(segment) || segment < 0)) return null

  const days = dayPart === null
    ? 0
    : Number.parseInt(dayPart, 10)
  if (Number.isNaN(days) || days < 0) return null

  if (segments.length === 2) {
    const [minutes, seconds] = segments
    return (days * 86_400) + (minutes * 60) + seconds
  }

  if (segments.length === 3) {
    const [hours, minutes, seconds] = segments
    return (days * 86_400) + (hours * 3_600) + (minutes * 60) + seconds
  }

  return null
}

async function resolveProcessUptimeSeconds(pid: number): Promise<number | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined

  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'etime=', '-p', String(pid)], {
      timeout: PROCESS_UPTIME_TIMEOUT_MS,
      maxBuffer: 8 * 1024,
    })
    const parsed = parseElapsedPsTime(stdout)
    return parsed ?? undefined
  } catch {
    return undefined
  }
}

function normalizeStatusData(cliData: unknown): GatewayStatusDTO {
  const root = asRecord(cliData)
  if (!root) {
    return { running: true }
  }

  const service = asRecord(root.service)
  const runtime = asRecord(service?.runtime)
  const connections = asRecord(root.connections)
  const memory = asRecord(root.memory)
  const gateway = asRecord(root.gateway)
  const self = asRecord(root.self)
  const gatewaySelf = asRecord(gateway?.self)

  const runningFromRuntime = (() => {
    const status = firstNonEmptyString([runtime?.status, runtime?.state])?.toLowerCase()
    if (!status) return undefined
    return status === 'running' || status === 'active'
  })()

  const pid = asNonNegativeInteger(root.pid) ?? asNonNegativeInteger(runtime?.pid)
  const uptimeSeconds = asNonNegativeInteger(root.uptime)
    ?? asNonNegativeInteger(runtime?.uptime)
    ?? asNonNegativeInteger(runtime?.uptimeSeconds)
    ?? (() => {
      const uptimeMs = asNonNegativeInteger(root.uptimeMs) ?? asNonNegativeInteger(runtime?.uptimeMs)
      return uptimeMs === undefined ? undefined : Math.floor(uptimeMs / 1000)
    })()

  const activeConnections = asNonNegativeInteger(connections?.active)
    ?? asNonNegativeInteger(root.clients)
  const idleConnections = asNonNegativeInteger(connections?.idle)
  const version = firstNonEmptyString([
    root.version,
    root.build,
    self?.version,
    gatewaySelf?.version,
  ])
  const heapUsed = asNonNegativeInteger(memory?.heapUsed)
  const heapTotal = asNonNegativeInteger(memory?.heapTotal)
  const rss = asNonNegativeInteger(memory?.rss)

  const normalized: GatewayStatusDTO = {
    running: typeof root.running === 'boolean' ? root.running : (runningFromRuntime ?? true),
    ...(pid !== undefined ? { pid } : {}),
    ...(uptimeSeconds !== undefined ? { uptime: uptimeSeconds } : {}),
    ...(version ? { version } : {}),
    ...(activeConnections !== undefined || idleConnections !== undefined ? {
      connections: {
        active: activeConnections ?? 0,
        idle: idleConnections ?? 0,
      },
    } : {}),
    ...(heapUsed !== undefined || heapTotal !== undefined || rss !== undefined ? {
      memory: {
        heapUsed: heapUsed ?? 0,
        heapTotal: heapTotal ?? 0,
        rss: rss ?? 0,
      },
    } : {}),
  }

  return {
    ...normalized,
  }
}

function mapProbeDto(probe: GatewayProbeStatus, fallbackLatencyMs: number): GatewayProbeDTO {
  return {
    reachable: probe.ok || probe.state === 'auth_required',
    latencyMs: probe.latencyMs ?? fallbackLatencyMs,
    ...(probe.error ? { error: probe.error } : {}),
  }
}

function authRequiredMessage(probe: GatewayProbeStatus): string | null {
  return probe.state === 'auth_required'
    ? 'Gateway reachable, authentication required'
    : null
}

// ============================================================================
// CLI IMPLEMENTATION
// ============================================================================

export function createCliGatewayRepo(): GatewayRepo {
  return {
    async status(): Promise<OpenClawResponse<GatewayStatusDTO>> {
      const cacheKey = 'gateway.status'
      const cached = getCached<GatewayStatusDTO>(cacheKey)
      if (cached) return cached

      const start = Date.now()

      try {
        const target = await resolveGatewayTarget()
        const probe = await probeGatewayHealth(target.gatewayUrl, target.token)
        const latencyMs = Date.now() - start

        if (!probe.ok && probe.state !== 'auth_required') {
          return {
            status: 'unavailable',
            latencyMs,
            data: null,
            error: probe.error ?? `Gateway unreachable at ${probe.url}`,
            timestamp: new Date().toISOString(),
            cached: false,
          }
        }

        let data: GatewayStatusDTO = { running: true }
        try {
          const cli = await runCommandJson<unknown>('status.noprobe.json', {
            timeout: Math.min(OPENCLAW_TIMEOUT_MS, GATEWAY_STATUS_ENRICH_TIMEOUT_MS),
          })
          if (!cli.error && cli.data) {
            data = normalizeStatusData(cli.data)
            if (data.running && data.pid !== undefined && data.uptime === undefined) {
              const processUptimeSeconds = await resolveProcessUptimeSeconds(data.pid)
              if (processUptimeSeconds !== undefined) {
                data = {
                  ...data,
                  uptime: processUptimeSeconds,
                }
              }
            }
          }
        } catch {
          // Keep probe-derived status when CLI enrichment fails.
        }

        const status = availabilityFromProbe(probe, latencyMs)
        const response: OpenClawResponse<GatewayStatusDTO> = {
          status,
          latencyMs,
          data,
          error: authRequiredMessage(probe),
          timestamp: new Date().toISOString(),
          cached: false,
        }

        setCache(cacheKey, response)
        return response
      } catch (err) {
        return {
          status: 'unavailable',
          latencyMs: Date.now() - start,
          data: null,
          error: err instanceof Error ? err.message : 'Unknown error',
          timestamp: new Date().toISOString(),
          cached: false,
        }
      }
    },

    async health(): Promise<OpenClawResponse<GatewayHealthDTO>> {
      const cacheKey = 'gateway.health'
      const cached = getCached<GatewayHealthDTO>(cacheKey)
      if (cached) return cached

      const start = Date.now()

      try {
        const target = await resolveGatewayTarget()
        const probe = await probeGatewayHealth(target.gatewayUrl, target.token)
        const latencyMs = Date.now() - start

        if (!probe.ok && probe.state !== 'auth_required') {
          return {
            status: 'unavailable',
            latencyMs,
            data: null,
            error: probe.error ?? `Gateway unreachable at ${probe.url}`,
            timestamp: new Date().toISOString(),
            cached: false,
          }
        }

        let data: GatewayHealthDTO = {
          healthy: probe.ok,
          checks: [
            {
              name: 'gateway_http_probe',
              status: probe.ok ? 'pass' : 'warn',
              message: probe.ok ? 'Gateway reachable' : 'Gateway reachable, authentication required',
            },
          ],
        }

        try {
          const cli = await runCommandJson<GatewayHealthDTO>('health.json', {
            timeout: OPENCLAW_TIMEOUT_MS,
          })
          if (!cli.error && cli.data) {
            data = {
              ...cli.data,
              healthy: typeof cli.data.healthy === 'boolean' ? cli.data.healthy : probe.ok,
            }
          }
        } catch {
          // Keep probe-derived health when CLI enrichment fails.
        }

        const status = availabilityFromProbe(probe, latencyMs)
        const response: OpenClawResponse<GatewayHealthDTO> = {
          status,
          latencyMs,
          data,
          error: authRequiredMessage(probe),
          timestamp: new Date().toISOString(),
          cached: false,
        }

        setCache(cacheKey, response)
        return response
      } catch (err) {
        return {
          status: 'unavailable',
          latencyMs: Date.now() - start,
          data: null,
          error: err instanceof Error ? err.message : 'Unknown error',
          timestamp: new Date().toISOString(),
          cached: false,
        }
      }
    },

    async probe(): Promise<OpenClawResponse<GatewayProbeDTO>> {
      // Probe is not cached - it's meant to be a fresh check
      const start = Date.now()

      try {
        const target = await resolveGatewayTarget()
        const probe = await probeGatewayHealth(target.gatewayUrl, target.token)
        const latencyMs = Date.now() - start

        if (!probe.ok && probe.state !== 'auth_required') {
          return {
            status: 'unavailable',
            latencyMs,
            data: mapProbeDto(probe, latencyMs),
            error: probe.error ?? `Gateway unreachable at ${probe.url}`,
            timestamp: new Date().toISOString(),
            cached: false,
          }
        }

        const status = availabilityFromProbe(probe, latencyMs)
        const probeData: GatewayProbeDTO = mapProbeDto(probe, latencyMs)

        return {
          status,
          latencyMs,
          data: probeData,
          error: authRequiredMessage(probe),
          timestamp: new Date().toISOString(),
          cached: false,
        }
      } catch (err) {
        const latencyMs = Date.now() - start
        return {
          status: 'unavailable',
          latencyMs,
          data: { reachable: false, latencyMs, error: err instanceof Error ? err.message : 'Unknown error' },
          error: err instanceof Error ? err.message : 'Unknown error',
          timestamp: new Date().toISOString(),
          cached: false,
        }
      }
    },
  }
}

// (No mock implementation: ClawControl must never return demo gateway data.)
