import { NextRequest, NextResponse } from 'next/server'
import { runDynamicCommandJson } from '@clawcontrol/adapters-openclaw'
import {
  type OpenClawResponse,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  clearCache,
} from '@/lib/openclaw/availability'
import { classifyOpenClawError } from '@/lib/openclaw/error-shape'

type EditMode = 'every' | 'cron' | 'at'

interface EditBody {
  mode?: EditMode
  every?: string
  cron?: string
  at?: string
  tz?: string
}

interface EditResult {
  jobId: string
  updated: boolean
  mode: EditMode
  message?: string
}

function unavailable(error: string, latencyMs: number): OpenClawResponse<EditResult> {
  return {
    status: 'unavailable',
    latencyMs,
    data: null,
    error,
    ...classifyOpenClawError(error),
    timestamp: new Date().toISOString(),
    cached: false,
  }
}

/**
 * POST /api/openclaw/cron/[id]/edit
 *
 * Edits the schedule/frequency for an existing cron job.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<OpenClawResponse<EditResult>>> {
  const { id: jobId } = await params

  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) {
    return NextResponse.json(unavailable('Invalid job ID format', 0))
  }

  let body: EditBody
  try {
    body = (await request.json()) as EditBody
  } catch {
    return NextResponse.json(unavailable('Invalid JSON body', 0))
  }

  const mode = body.mode
  if (mode !== 'every' && mode !== 'cron' && mode !== 'at') {
    return NextResponse.json(unavailable('Missing or invalid mode (every|cron|at)', 0))
  }

  const start = Date.now()

  try {
    let res:
      | { data?: unknown; error?: string; exitCode: number }
      | null = null

    if (mode === 'every') {
      if (!body.every || typeof body.every !== 'string') {
        return NextResponse.json(unavailable('Missing every value', Date.now() - start))
      }
      res = await runDynamicCommandJson('cron.edit.every', {
        id: jobId,
        every: body.every.trim(),
      }, {
        timeout: OPENCLAW_TIMEOUT_MS,
      })
    }

    if (mode === 'cron') {
      if (!body.cron || typeof body.cron !== 'string') {
        return NextResponse.json(unavailable('Missing cron expression', Date.now() - start))
      }

      const params: Record<string, string> = {
        id: jobId,
        cron: body.cron.trim(),
      }
      if (body.tz && typeof body.tz === 'string' && body.tz.trim()) {
        params.tz = body.tz.trim()
      }

      res = await runDynamicCommandJson('cron.edit.cron', params, {
        timeout: OPENCLAW_TIMEOUT_MS,
      })
    }

    if (mode === 'at') {
      if (!body.at || typeof body.at !== 'string') {
        return NextResponse.json(unavailable('Missing at value', Date.now() - start))
      }
      res = await runDynamicCommandJson('cron.edit.at', {
        id: jobId,
        at: body.at.trim(),
      }, {
        timeout: OPENCLAW_TIMEOUT_MS,
      })
    }

    const latencyMs = Date.now() - start

    if (!res || res.error) {
      return NextResponse.json(unavailable(res?.error ?? 'Failed to edit cron job', latencyMs))
    }

    clearCache('cron.jobs')

    return NextResponse.json({
      status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok',
      latencyMs,
      data: {
        jobId,
        updated: true,
        mode,
      },
      error: null,
      timestamp: new Date().toISOString(),
      cached: false,
    })
  } catch (err) {
    return NextResponse.json(
      unavailable(err instanceof Error ? err.message : 'Unknown error', Date.now() - start)
    )
  }
}
