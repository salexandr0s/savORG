import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// ============================================================================
// GET /api/openclaw/console/sessions/[id]
// ============================================================================

/**
 * Get a single session by sessionId.
 * Read-only - no governor required.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params

  try {
    const session = await prisma.agentSession.findUnique({
      where: { sessionId },
    })

    if (!session) {
      return NextResponse.json(
        { ok: false, error: 'Session not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      ok: true,
      data: {
        id: session.id,
        sessionId: session.sessionId,
        sessionKey: session.sessionKey,
        agentId: session.agentId,
        kind: session.kind,
        model: session.model,
        state: session.state,
        percentUsed: session.percentUsed,
        abortedLastRun: session.abortedLastRun,
        operationId: session.operationId,
        workOrderId: session.workOrderId,
        lastSeenAt: session.lastSeenAt,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        // Include raw JSON for debugging
        rawJson: session.rawJson ? JSON.parse(session.rawJson) : null,
      },
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to fetch session',
      },
      { status: 500 }
    )
  }
}
