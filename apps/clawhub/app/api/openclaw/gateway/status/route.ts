import { NextResponse } from 'next/server'
import { runCommandJson } from '@clawhub/adapters-openclaw'
import {
  type OpenClawResponse,
  OPENCLAW_TIMEOUT_MS,
  DEGRADED_THRESHOLD_MS,
  getCached,
  setCache,
} from '@/lib/openclaw/availability'

/**
 * Gateway status response from OpenClaw CLI.
 * Based on `openclaw gateway status --json` output.
 */
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

const CACHE_KEY = 'gateway.status'

/**
 * GET /api/openclaw/gateway/status
 *
 * Returns gateway status with explicit availability semantics.
 * Always returns 200 with structured OpenClawResponse (not 500).
 */
export async function GET(): Promise<NextResponse<OpenClawResponse<GatewayStatusDTO>>> {
  // Check cache first (15s TTL to prevent refresh cascade)
  const cached = getCached<GatewayStatusDTO>(CACHE_KEY)
  if (cached) {
    return NextResponse.json(cached)
  }

  const start = Date.now()

  try {
    const res = await runCommandJson<GatewayStatusDTO>('status.json', {
      timeout: OPENCLAW_TIMEOUT_MS,
    })

    const latencyMs = Date.now() - start

    if (res.error || !res.data) {
      const response: OpenClawResponse<GatewayStatusDTO> = {
        status: 'unavailable',
        latencyMs,
        data: null,
        error: res.error ?? 'Failed to get gateway status',
        timestamp: new Date().toISOString(),
        cached: false,
      }
      // Don't cache unavailable responses - allow immediate retry
      return NextResponse.json(response)
    }

    const response: OpenClawResponse<GatewayStatusDTO> = {
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
    const response: OpenClawResponse<GatewayStatusDTO> = {
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
