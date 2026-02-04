/**
 * Cron Repository
 *
 * Availability-aware repository for OpenClaw cron operations.
 * Returns OpenClawResponse<T> with explicit ok|degraded|unavailable status.
 */

import { runCommandJson, runDynamicCommandJson } from '@clawhub/adapters-openclaw'
import {
  type OpenClawResponse,
  type AvailabilityStatus,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  CACHE_TTL_MS,
} from '@/lib/openclaw/availability'

// ============================================================================
// TYPES
// ============================================================================

export interface CronStatusDTO {
  running: boolean
  jobCount: number
  nextRun?: string
  lastRun?: string
  uptime?: number
}

export interface CronSchedule {
  kind: 'at' | 'every' | 'cron'
  atMs?: number
  everyMs?: number
  expr?: string
  tz?: string
}

export interface CronPayload {
  kind: 'systemEvent' | 'agentTurn'
  text?: string
  message?: string
  deliver?: boolean
  channel?: string
  to?: string
}

export interface CronJobDTO {
  id: string
  name: string
  schedule: CronSchedule
  sessionTarget: 'main' | 'isolated'
  wakeMode: 'now' | 'next-heartbeat'
  payload: CronPayload
  agentId?: string
  description?: string
  enabled?: boolean
  deleteAfterRun?: boolean
  lastRunAt?: string
  nextRunAt?: string
  lastStatus?: 'success' | 'failed' | 'running'
  runCount?: number
}

export interface CronRunDTO {
  id: string
  jobId: string
  startedAt: string
  endedAt?: string
  status: 'success' | 'failed' | 'running'
  durationMs?: number
  exitCode?: number
  error?: string
  output?: string
}

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface CronRepo {
  status(): Promise<OpenClawResponse<CronStatusDTO>>
  list(): Promise<OpenClawResponse<CronJobDTO[]>>
  runs(jobId: string): Promise<OpenClawResponse<CronRunDTO[]>>
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

// ============================================================================
// CLI IMPLEMENTATION
// ============================================================================

export function createCliCronRepo(): CronRepo {
  return {
    async status(): Promise<OpenClawResponse<CronStatusDTO>> {
      const cacheKey = 'cron.status'
      const cached = getCached<CronStatusDTO>(cacheKey)
      if (cached) return cached

      const start = Date.now()

      try {
        const res = await runCommandJson<CronStatusDTO>('cron.status.json', {
          timeout: OPENCLAW_TIMEOUT_MS,
        })

        const latencyMs = Date.now() - start

        if (res.error || !res.data) {
          return {
            status: 'unavailable',
            latencyMs,
            data: null,
            error: res.error ?? 'Failed to get cron status',
            timestamp: new Date().toISOString(),
            cached: false,
          }
        }

        const status: AvailabilityStatus = latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok'
        const response: OpenClawResponse<CronStatusDTO> = {
          status,
          latencyMs,
          data: res.data,
          error: null,
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

    async list(): Promise<OpenClawResponse<CronJobDTO[]>> {
      const cacheKey = 'cron.jobs'
      const cached = getCached<CronJobDTO[]>(cacheKey)
      if (cached) return cached

      const start = Date.now()

      try {
        const res = await runCommandJson<CronJobDTO[]>('cron.jobs.json', {
          timeout: OPENCLAW_TIMEOUT_MS,
        })

        const latencyMs = Date.now() - start

        if (res.error) {
          return {
            status: 'unavailable',
            latencyMs,
            data: null,
            error: res.error,
            timestamp: new Date().toISOString(),
            cached: false,
          }
        }

        // CLI may return null/undefined for empty list
        const jobs = res.data ?? []

        const status: AvailabilityStatus = latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok'
        const response: OpenClawResponse<CronJobDTO[]> = {
          status,
          latencyMs,
          data: jobs,
          error: null,
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

    async runs(jobId: string): Promise<OpenClawResponse<CronRunDTO[]>> {
      // Validate jobId format
      if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
        return {
          status: 'unavailable',
          latencyMs: 0,
          data: null,
          error: 'Invalid job ID format',
          timestamp: new Date().toISOString(),
          cached: false,
        }
      }

      const cacheKey = `cron.runs.${jobId}`
      const cached = getCached<CronRunDTO[]>(cacheKey)
      if (cached) return cached

      const start = Date.now()

      try {
        const res = await runDynamicCommandJson<CronRunDTO[]>('cron.runs', { id: jobId }, {
          timeout: OPENCLAW_TIMEOUT_MS,
        })

        const latencyMs = Date.now() - start

        if (res.error) {
          return {
            status: 'unavailable',
            latencyMs,
            data: null,
            error: res.error,
            timestamp: new Date().toISOString(),
            cached: false,
          }
        }

        // CLI may return null/undefined for empty list
        const runs = res.data ?? []

        const status: AvailabilityStatus = latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok'
        const response: OpenClawResponse<CronRunDTO[]> = {
          status,
          latencyMs,
          data: runs,
          error: null,
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
  }
}

// ============================================================================
// MOCK IMPLEMENTATION
// ============================================================================

export function createMockCronRepo(): CronRepo {
  const mockJobs: CronJobDTO[] = [
    {
      id: 'mock-job-1',
      name: 'daily-backup',
      schedule: { kind: 'cron', expr: '0 2 * * *', tz: 'America/Los_Angeles' },
      sessionTarget: 'isolated',
      wakeMode: 'now',
      payload: { kind: 'systemEvent', text: 'Run daily backup' },
      description: 'Daily database backup',
      enabled: true,
      lastRunAt: new Date(Date.now() - 86400000).toISOString(),
      nextRunAt: new Date(Date.now() + 43200000).toISOString(),
      lastStatus: 'success',
      runCount: 30,
    },
    {
      id: 'mock-job-2',
      name: 'hourly-sync',
      schedule: { kind: 'every', everyMs: 3600000 },
      sessionTarget: 'main',
      wakeMode: 'next-heartbeat',
      payload: { kind: 'agentTurn', message: 'Sync external data' },
      description: 'Hourly data synchronization',
      enabled: true,
      lastRunAt: new Date(Date.now() - 1800000).toISOString(),
      nextRunAt: new Date(Date.now() + 1800000).toISOString(),
      lastStatus: 'success',
      runCount: 720,
    },
  ]

  const mockRuns: Record<string, CronRunDTO[]> = {
    'mock-job-1': [
      {
        id: 'run-1',
        jobId: 'mock-job-1',
        startedAt: new Date(Date.now() - 86400000).toISOString(),
        endedAt: new Date(Date.now() - 86400000 + 30000).toISOString(),
        status: 'success',
        durationMs: 30000,
        exitCode: 0,
      },
      {
        id: 'run-2',
        jobId: 'mock-job-1',
        startedAt: new Date(Date.now() - 172800000).toISOString(),
        endedAt: new Date(Date.now() - 172800000 + 28000).toISOString(),
        status: 'success',
        durationMs: 28000,
        exitCode: 0,
      },
    ],
    'mock-job-2': [
      {
        id: 'run-3',
        jobId: 'mock-job-2',
        startedAt: new Date(Date.now() - 1800000).toISOString(),
        endedAt: new Date(Date.now() - 1800000 + 5000).toISOString(),
        status: 'success',
        durationMs: 5000,
        exitCode: 0,
      },
    ],
  }

  return {
    async status(): Promise<OpenClawResponse<CronStatusDTO>> {
      return {
        status: 'ok',
        latencyMs: 5,
        data: {
          running: true,
          jobCount: mockJobs.length,
          nextRun: mockJobs[0]?.nextRunAt,
          lastRun: mockJobs[0]?.lastRunAt,
          uptime: 3600000,
        },
        error: null,
        timestamp: new Date().toISOString(),
        cached: false,
      }
    },

    async list(): Promise<OpenClawResponse<CronJobDTO[]>> {
      return {
        status: 'ok',
        latencyMs: 8,
        data: mockJobs,
        error: null,
        timestamp: new Date().toISOString(),
        cached: false,
      }
    },

    async runs(jobId: string): Promise<OpenClawResponse<CronRunDTO[]>> {
      const runs = mockRuns[jobId] ?? []
      return {
        status: 'ok',
        latencyMs: 6,
        data: runs,
        error: null,
        timestamp: new Date().toISOString(),
        cached: false,
      }
    },
  }
}
