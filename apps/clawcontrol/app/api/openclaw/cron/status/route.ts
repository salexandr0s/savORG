import { NextResponse } from 'next/server'
import { runCommandJson } from '@clawcontrol/adapters-openclaw'
import {
  type OpenClawResponse,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  getCached,
  setCache,
} from '@/lib/openclaw/availability'

/**
 * Cron scheduler status response from OpenClaw CLI.
 * Based on `openclaw cron status --json` output.
 */
export interface CronStatusDTO {
  running: boolean
  jobCount: number
  nextRun?: string
  lastRun?: string
  uptime?: number
}

const CACHE_KEY = 'cron.status'

/**
 * GET /api/openclaw/cron/status
 *
 * Returns cron scheduler status with explicit availability semantics.
 * Always returns 200 with structured OpenClawResponse (not 500).
 */
export async function GET(): Promise<NextResponse<OpenClawResponse<CronStatusDTO>>> {
  // Check cache first (15s TTL to prevent refresh cascade)
  const cached = getCached<CronStatusDTO>(CACHE_KEY)
  if (cached) {
    return NextResponse.json(cached)
  }

  const start = Date.now()

  try {
    const res = await runCommandJson<CronStatusDTO>('cron.status.json', {
      timeout: OPENCLAW_TIMEOUT_MS,
    })

    const latencyMs = Date.now() - start

    if (res.error || !res.data) {
      const response: OpenClawResponse<CronStatusDTO> = {
        status: 'unavailable',
        latencyMs,
        data: null,
        error: res.error ?? 'Failed to get cron status',
        timestamp: new Date().toISOString(),
        cached: false,
      }
      return NextResponse.json(response)
    }

    const response: OpenClawResponse<CronStatusDTO> = {
      status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok',
      latencyMs,
      data: res.data,
      error: null,
      timestamp: new Date().toISOString(),
      cached: false,
    }

    setCache(CACHE_KEY, response)
    return NextResponse.json(response)
  } catch (err) {
    const latencyMs = Date.now() - start
    const response: OpenClawResponse<CronStatusDTO> = {
      status: 'unavailable',
      latencyMs,
      data: null,
      error: err instanceof Error ? err.message : 'Unknown error',
      timestamp: new Date().toISOString(),
      cached: false,
    }
    return NextResponse.json(response)
  }
}
