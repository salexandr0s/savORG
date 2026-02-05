import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { checkGatewayAvailability, getSessionHistory } from '@/lib/openclaw/console-client'

// ============================================================================
// TYPES
// ============================================================================

interface HistoryMessage {
  id: string
  ts: Date
  type: string
  actor: string
  summary: string
  role: 'operator' | 'agent' | 'system'
  payload?: Record<string, unknown>
}

interface HistoryResponse {
  ok: boolean
  source: 'activities' | 'gateway'
  messages: HistoryMessage[]
  sessionId: string
  agentId: string
}

// ============================================================================
// GET /api/openclaw/console/sessions/[id]/history
// ============================================================================

/**
 * Get session history/transcript.
 *
 * Currently builds history from activities table since no CLI command exists.
 * Future: May add gateway HTTP endpoint for true transcript.
 *
 * Query params:
 * - limit: Max messages (default 200)
 *
 * Read-only - no governor required.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params
  const { searchParams } = new URL(request.url)
  const limit = Math.min(Number(searchParams.get('limit') ?? 200), 500)

  try {
    // Verify session exists
    const session = await prisma.agentSession.findUnique({
      where: { sessionId },
    })

    if (!session) {
      return NextResponse.json(
        { ok: false, error: 'Session not found' },
        { status: 404 }
      )
    }

    // Prefer gateway transcript when available
    try {
      const availability = await checkGatewayAvailability()
      if (availability.available) {
        const history = await getSessionHistory(session.sessionKey, limit)

        const messages: HistoryMessage[] = history.messages.map((m, idx) => {
          const text = extractTextFromContent(m.content)
          const tsMs = normalizeTimestampMs(m.timestamp)
          const ts = tsMs ? new Date(tsMs) : new Date()

          const role: HistoryMessage['role'] =
            m.role === 'user' ? 'operator' : m.role === 'assistant' ? 'agent' : 'system'

          return {
            id: `gw_${sessionId}_${ts.getTime()}_${idx}`,
            ts,
            type: 'openclaw.gateway.chat.history',
            actor: m.role === 'assistant' ? `agent:${session.agentId}` : 'operator:history',
            summary: text.length > 140 ? text.slice(0, 140) + '…' : text,
            role,
            payload: { content: text },
          }
        })

        const response: HistoryResponse = {
          ok: true,
          source: 'gateway',
          messages,
          sessionId,
          agentId: session.agentId,
        }

        return NextResponse.json(response)
      }
    } catch {
      // Fall back to activities transcript
    }

    // Build history from activities related to this session
    // Filter by entityId matching sessionId or entityType 'session'
    const activities = await prisma.activity.findMany({
      where: {
        OR: [
          // Activities directly about this session
          { entityType: 'session', entityId: sessionId },
          // Chat activities for this session
          {
            type: 'openclaw.chat.send',
            payloadJson: { contains: sessionId },
          },
          // Agent activities for this agent (fallback)
          { entityType: 'agent', entityId: session.agentId },
        ],
      },
      orderBy: { ts: 'asc' },
      take: limit,
    })

    // Map activities to history messages
    const messages: HistoryMessage[] = activities.map((a) => {
      // Determine role based on actor and type
      let role: 'operator' | 'agent' | 'system' = 'system'
      if (a.actor.startsWith('operator:') || a.actor === 'user') {
        role = 'operator'
      } else if (a.actor.startsWith('agent:') || a.type.includes('.response')) {
        role = 'agent'
      }

      let payload: Record<string, unknown> | undefined
      try {
        payload = a.payloadJson ? JSON.parse(a.payloadJson) : undefined
      } catch {
        // Ignore parse errors
      }

      return {
        id: a.id,
        ts: a.ts,
        type: a.type,
        actor: a.actor,
        summary: a.summary,
        role,
        payload,
      }
    })

    const response: HistoryResponse = {
      ok: true,
      source: 'activities',
      messages,
      sessionId,
      agentId: session.agentId,
    }

    return NextResponse.json(response)
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Failed to fetch history',
      },
      { status: 500 }
    )
  }
}

function normalizeTimestampMs(ts: unknown): number | null {
  if (typeof ts !== 'number' || Number.isNaN(ts)) return null
  // Heuristic: seconds vs ms
  if (ts < 1_000_000_000_000) {
    return Math.floor(ts * 1000)
  }
  return Math.floor(ts)
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') return content

  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const item of content) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      if (obj.type === 'text' && typeof obj.text === 'string') {
        parts.push(obj.text)
      }
    }
    if (parts.length > 0) return parts.join('')
  }

  if (content && typeof content === 'object') {
    const obj = content as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text
    if ('content' in obj) return extractTextFromContent(obj.content)
  }

  return ''
}
