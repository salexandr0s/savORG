/**
 * Gateway Live Graph SSE Streaming API
 *
 * Streams real-time graph updates from the OpenClaw Gateway to connected browsers.
 * The browser connects via EventSource; the server is the only WS client to the Gateway.
 *
 * Events emitted:
 * - connected: Initial connection with mirror status
 * - snapshot: Full graph state (capped at 500 nodes, 800 edges)
 * - delta: Incremental updates (added/updated/removed nodes and edges)
 * - keepalive: Heartbeat every 30s
 */

import { NextRequest } from 'next/server'
import {
  checkConnectionLimit,
  incrementConnection,
  decrementConnection,
} from '@/lib/sse-limiter'
import { getMirrorService } from '@/lib/openclaw/live-graph'
import type { GraphUpdate, GraphDelta, GraphSnapshot } from '@/lib/openclaw/live-graph'

const ENDPOINT_NAME = 'openclaw-graph'
const KEEPALIVE_INTERVAL_MS = 30_000
const MAX_SNAPSHOT_NODES = 500
const MAX_SNAPSHOT_EDGES = 800

export async function GET(request: NextRequest) {
  // Rate limiting (max 50 concurrent clients)
  if (!checkConnectionLimit(ENDPOINT_NAME)) {
    return new Response('Too many connections', { status: 429 })
  }

  incrementConnection(ENDPOINT_NAME)

  // Parse filters from query params
  const params = request.nextUrl.searchParams
  const agentId = params.get('agentId') || undefined
  const sessionKeyPattern = params.get('sessionKey') || undefined
  const channel = params.get('channel') || undefined

  const encoder = new TextEncoder()
  const mirror = getMirrorService()

  // Track if stream is still active
  let streamActive = true

  const stream = new ReadableStream({
    start(controller) {
      // Helper to send SSE event
      const sendEvent = (event: string, data: unknown) => {
        if (!streamActive) return
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          )
        } catch {
          // Stream closed
          streamActive = false
        }
      }

      // Send initial connection status
      const status = mirror.getStatus()
      sendEvent('connected', { status })

      // Send initial snapshot (filtered and capped)
      const rawSnapshot = mirror.getFilteredSnapshot({
        agentId,
        sessionKeyPattern,
        channel,
      })

      const cappedSnapshot = capSnapshot(rawSnapshot)
      sendEvent('snapshot', cappedSnapshot)

      // Subscribe to deltas
      const unsubscribe = mirror.subscribe((update: GraphUpdate) => {
        if (!streamActive) return

        if (update.type === 'delta' && update.delta) {
          // Apply filters to delta
          const filteredDelta = filterDelta(update.delta, {
            agentId,
            sessionKeyPattern,
            channel,
          })

          // Only send if there's something to send
          if (
            filteredDelta.addedNodes.length > 0 ||
            filteredDelta.updatedNodes.length > 0 ||
            filteredDelta.removedNodeIds.length > 0 ||
            filteredDelta.addedEdges.length > 0 ||
            filteredDelta.removedEdgeIds.length > 0
          ) {
            sendEvent('delta', filteredDelta)
          }
        }
      })

      // Keepalive timer
      const keepaliveInterval = setInterval(() => {
        if (!streamActive) {
          clearInterval(keepaliveInterval)
          return
        }
        try {
          controller.enqueue(encoder.encode(`: keepalive\n\n`))
        } catch {
          clearInterval(keepaliveInterval)
          streamActive = false
        }
      }, KEEPALIVE_INTERVAL_MS)

      // Cleanup on abort
      request.signal.addEventListener('abort', () => {
        streamActive = false
        clearInterval(keepaliveInterval)
        unsubscribe()
        decrementConnection(ENDPOINT_NAME)
        controller.close()
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  })
}

/**
 * Cap snapshot to prevent excessive initial payload.
 */
function capSnapshot(snapshot: GraphSnapshot): GraphSnapshot {
  return {
    ...snapshot,
    nodes: snapshot.nodes.slice(0, MAX_SNAPSHOT_NODES),
    edges: snapshot.edges.slice(0, MAX_SNAPSHOT_EDGES),
  }
}

/**
 * Filter delta updates based on query params.
 */
function filterDelta(
  delta: GraphDelta,
  filters: {
    agentId?: string
    sessionKeyPattern?: string
    channel?: string
  }
): GraphDelta {
  let { addedNodes, updatedNodes } = delta
  const { addedEdges } = delta
  const { removedNodeIds, removedEdgeIds, lastEventId } = delta

  // Filter nodes
  if (filters.agentId) {
    addedNodes = addedNodes.filter((n) => n.agentId === filters.agentId)
    updatedNodes = updatedNodes.filter((n) => n.agentId === filters.agentId)
  }

  if (filters.sessionKeyPattern) {
    const pattern = new RegExp(filters.sessionKeyPattern, 'i')
    addedNodes = addedNodes.filter((n) => n.sessionKey && pattern.test(n.sessionKey))
    updatedNodes = updatedNodes.filter((n) => n.sessionKey && pattern.test(n.sessionKey))
  }

  if (filters.channel) {
    addedNodes = addedNodes.filter(
      (n) => n.kind !== 'chat' || n.metadata.channel === filters.channel
    )
    updatedNodes = updatedNodes.filter(
      (n) => n.kind !== 'chat' || n.metadata.channel === filters.channel
    )
  }

  // Filter edges to only include those connecting filtered nodes
  // For simplicity, we include all edges here - the client can filter further
  // A more complete implementation would track which node IDs are in the client's view

  return {
    addedNodes,
    updatedNodes,
    removedNodeIds,
    addedEdges,
    removedEdgeIds,
    lastEventId,
  }
}
