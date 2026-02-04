import { NextRequest, NextResponse } from 'next/server'
import { runDynamicCommandJson } from '@clawcontrol/adapters-openclaw'
import {
  type OpenClawResponse,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  getCached,
  setCache,
} from '@/lib/openclaw/availability'

/**
 * Cron run DTO from OpenClaw CLI.
 * Based on `openclaw cron runs --id <jobId> --json` output.
 */
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

/**
 * GET /api/openclaw/cron/runs?id=<jobId>
 *
 * Returns run history for a specific cron job.
 * The `id` query parameter is REQUIRED.
 *
 * Always returns 200 with structured OpenClawResponse (not 500).
 */
export async function GET(request: NextRequest): Promise<NextResponse<OpenClawResponse<CronRunDTO[]> | { error: string }>> {
  const { searchParams } = new URL(request.url)
  const jobId = searchParams.get('id')

  // id parameter is required (CLI requires --id flag)
  if (!jobId) {
    return NextResponse.json(
      { error: 'Missing required parameter: id' },
      { status: 400 }
    )
  }

  // Validate jobId format (alphanumeric + dash/underscore)
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return NextResponse.json(
      { error: 'Invalid job ID format' },
      { status: 400 }
    )
  }

  const cacheKey = `cron.runs.${jobId}`

  // Check cache first (15s TTL to prevent refresh cascade)
  const cached = getCached<CronRunDTO[]>(cacheKey)
  if (cached) {
    return NextResponse.json(cached)
  }

  const start = Date.now()

  try {
    const res = await runDynamicCommandJson<CronRunDTO[]>('cron.runs', { id: jobId }, {
      timeout: OPENCLAW_TIMEOUT_MS,
    })

    const latencyMs = Date.now() - start

    if (res.error) {
      const response: OpenClawResponse<CronRunDTO[]> = {
        status: 'unavailable',
        latencyMs,
        data: null,
        error: res.error,
        timestamp: new Date().toISOString(),
        cached: false,
      }
      return NextResponse.json(response)
    }

    // CLI may return null/undefined for empty list
    const runs = res.data ?? []

    const response: OpenClawResponse<CronRunDTO[]> = {
      status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok',
      latencyMs,
      data: runs,
      error: null,
      timestamp: new Date().toISOString(),
      cached: false,
    }

    setCache(cacheKey, response)
    return NextResponse.json(response)
  } catch (err) {
    const latencyMs = Date.now() - start
    const response: OpenClawResponse<CronRunDTO[]> = {
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
