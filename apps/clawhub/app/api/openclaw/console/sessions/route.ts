import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { checkGatewayAvailability } from '@/lib/openclaw/console-client'
import type { AvailabilityStatus } from '@/lib/openclaw/availability'

// ============================================================================
// TYPES
// ============================================================================

export interface ConsoleSessionDTO {
  id: string
  sessionId: string
  sessionKey: string
  agentId: string
  kind: string
  model: string | null
  state: string
  percentUsed: number | null
  abortedLastRun: boolean
  operationId: string | null
  workOrderId: string | null
  lastSeenAt: Date
  createdAt: Date
  updatedAt: Date
}

interface SessionsResponse {
  status: AvailabilityStatus
  data: ConsoleSessionDTO[]
  gatewayAvailable: boolean
  cached: boolean
  timestamp: string
}

// ============================================================================
// GET /api/openclaw/console/sessions
// ============================================================================

/**
 * List sessions for the operator console.
 *
 * Query params:
 * - agentId: Filter by agent
 * - state: Filter by state (active, idle, error)
 * - kind: Filter by session kind
 * - limit: Max results (default 200, max 500)
 *
 * Returns cached session data from DB with gateway availability status.
 * Read-only - no governor required.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const agentId = searchParams.get('agentId')
  const state = searchParams.get('state')
  const kind = searchParams.get('kind')
  const limit = Math.min(Number(searchParams.get('limit') ?? 200), 500)

  try {
    // Query sessions from DB (telemetry cache)
    const rows = await prisma.agentSession.findMany({
      where: {
        ...(agentId ? { agentId } : {}),
        ...(state ? { state } : {}),
        ...(kind ? { kind } : {}),
      },
      orderBy: { lastSeenAt: 'desc' },
      take: limit,
    })

    // Check gateway availability in parallel
    const availability = await checkGatewayAvailability()

    // Map to DTO
    const data: ConsoleSessionDTO[] = rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      sessionKey: r.sessionKey,
      agentId: r.agentId,
      kind: r.kind,
      model: r.model,
      state: r.state,
      percentUsed: r.percentUsed,
      abortedLastRun: r.abortedLastRun,
      operationId: r.operationId,
      workOrderId: r.workOrderId,
      lastSeenAt: r.lastSeenAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))

    // Determine status based on gateway availability
    const status: AvailabilityStatus = availability.available
      ? (availability.latencyMs > 30000 ? 'degraded' : 'ok')
      : 'unavailable'

    const response: SessionsResponse = {
      status,
      data,
      gatewayAvailable: availability.available,
      cached: true, // Always from DB cache
      timestamp: new Date().toISOString(),
    }

    return NextResponse.json(response)
  } catch (err) {
    return NextResponse.json(
      {
        status: 'unavailable' as AvailabilityStatus,
        data: [],
        gatewayAvailable: false,
        cached: false,
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : 'Failed to fetch sessions',
      },
      { status: 500 }
    )
  }
}
