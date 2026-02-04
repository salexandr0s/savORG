/**
 * Gateway Event Normalizer
 *
 * Converts raw Gateway WebSocket frames into normalized GatewayEvent objects.
 * Handles the mapping from Crabwalk-compatible events to our internal types.
 */

import { randomUUID } from 'crypto'
import type {
  GatewayFrame,
  GatewayFrameData,
  GatewayEvent,
  GatewayEventKind,
  GatewayEventSource,
  GraphNode,
  GraphEdge,
  GraphEdgeKind,
  EdgeConfidence,
} from './types'
import { createSafePayload } from './redaction'

// ============================================================================
// EVENT NORMALIZATION
// ============================================================================

/**
 * Normalize a raw Gateway frame into a GatewayEvent.
 * Returns null if the frame should be ignored (health, tick, etc.)
 */
export function normalizeFrame(frame: GatewayFrame): GatewayEvent | null {
  const { event, data } = frame

  // Ignore health checks and heartbeats
  if (event === 'health' || event === 'tick' || event === 'connect.challenge') {
    return null
  }

  // Extract session info
  const sessionKey = data?.sessionKey ?? ''
  const sessionId = data?.sessionId ?? deriveSessionId(sessionKey)
  const agentId = data?.agentId ?? extractAgentId(sessionKey)

  // Determine event kind
  const kind = determineEventKind(event, data)
  if (!kind) return null

  // Build source for debugging
  const source: GatewayEventSource = {
    event,
    stream: data?.stream,
    dataType: data?.type,
  }

  // Create safe payload (redacted)
  const payload = createSafePayload(data, sessionKey)

  return {
    id: randomUUID(),
    kind,
    ts: new Date(),
    sessionId,
    sessionKey,
    agentId,
    source,
    payload,
  }
}

/**
 * Determine the normalized event kind from raw frame.
 */
function determineEventKind(
  event: GatewayFrame['event'],
  data: GatewayFrameData | undefined
): GatewayEventKind | null {
  switch (event) {
    case 'chat':
      return 'gw.chat'

    case 'agent':
      if (data?.stream === 'lifecycle') {
        return data.phase === 'start' ? 'gw.turn.start' : 'gw.turn.end'
      }
      if (data?.stream === 'assistant') {
        return 'gw.assistant'
      }
      if (data?.type === 'tool_use') {
        return 'gw.tool.start'
      }
      if (data?.type === 'tool_result') {
        return 'gw.tool.end'
      }
      // Unknown agent event - skip
      return null

    case 'exec.started':
      return 'gw.tool.start'

    case 'exec.output':
      // We can choose to skip these or aggregate them
      // For now, skip individual output chunks
      return null

    case 'exec.completed':
      return 'gw.tool.end'

    default:
      return null
  }
}

/**
 * Derive a session ID from session key if not provided.
 */
function deriveSessionId(sessionKey: string): string {
  if (!sessionKey) return randomUUID()
  // Use a hash-like derivation from the key
  // In practice, the gateway usually provides sessionId
  return `session:${sessionKey.slice(0, 16)}`
}

/**
 * Extract agent ID from session key.
 * Session keys often contain the agent name.
 */
function extractAgentId(sessionKey: string): string {
  // Common patterns: "agentName:...", "clawBUILD:...", etc.
  const colonIndex = sessionKey.indexOf(':')
  if (colonIndex > 0) {
    return sessionKey.slice(0, colonIndex)
  }
  return 'unknown'
}

// ============================================================================
// GRAPH NODE/EDGE CREATION
// ============================================================================

/**
 * Create or update graph nodes from a normalized event.
 * Returns the nodes to upsert and any new edges to add.
 */
export function eventToGraphUpdates(event: GatewayEvent): {
  nodes: GraphNode[]
  edges: GraphEdge[]
} {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  // Always ensure a session node exists
  const sessionNode = createSessionNode(event)
  nodes.push(sessionNode)

  // Create specific nodes based on event kind
  switch (event.kind) {
    case 'gw.chat': {
      const chatNode = createChatNode(event)
      nodes.push(chatNode)
      // Edge: chat triggered session
      edges.push(createEdge(chatNode.id, sessionNode.id, 'triggered', 'high'))
      break
    }

    case 'gw.turn.start':
    case 'gw.turn.end': {
      const turnNode = createTurnNode(event)
      nodes.push(turnNode)
      // Edge: session -> turn
      edges.push(createEdge(sessionNode.id, turnNode.id, 'triggered', 'high'))
      break
    }

    case 'gw.tool.start':
    case 'gw.tool.end': {
      const toolNode = createToolCallNode(event)
      nodes.push(toolNode)
      // Edge: session used tool (simplified - ideally turn -> tool)
      edges.push(createEdge(sessionNode.id, toolNode.id, 'used_tool', 'high'))
      break
    }

    case 'gw.assistant': {
      const assistantNode = createAssistantNode(event)
      nodes.push(assistantNode)
      // Edge: session -> assistant
      edges.push(createEdge(sessionNode.id, assistantNode.id, 'replied', 'high'))
      break
    }

    case 'gw.spawn': {
      // This is handled separately via findParentSession
      // The event itself creates a session node marked as subagent
      break
    }
  }

  return { nodes, edges }
}

/**
 * Create a session graph node.
 */
function createSessionNode(event: GatewayEvent): GraphNode {
  return {
    id: `session:${event.sessionId}`,
    kind: 'session',
    sessionId: event.sessionId,
    sessionKey: event.sessionKey,
    agentId: event.agentId,
    operationId: event.payload.operationId,
    workOrderId: event.payload.workOrderId,
    status: 'active',
    startedAt: event.ts,
    lastActivity: event.ts,
    isPinned: false,
    metadata: {
      isSubagent: event.payload.isSubagent,
    },
  }
}

/**
 * Create a chat graph node.
 */
function createChatNode(event: GatewayEvent): GraphNode {
  return {
    id: `chat:${event.id}`,
    kind: 'chat',
    sessionId: event.sessionId,
    sessionKey: event.sessionKey,
    agentId: event.agentId,
    operationId: event.payload.operationId,
    workOrderId: event.payload.workOrderId,
    status: 'completed',
    startedAt: event.ts,
    lastActivity: event.ts,
    isPinned: false,
    metadata: {
      channel: event.payload.channel,
      messageId: event.payload.messageId,
    },
  }
}

/**
 * Create a turn graph node.
 */
function createTurnNode(event: GatewayEvent): GraphNode {
  const isStart = event.kind === 'gw.turn.start'
  return {
    id: `turn:${event.sessionId}:${event.id}`,
    kind: 'turn',
    sessionId: event.sessionId,
    sessionKey: event.sessionKey,
    agentId: event.agentId,
    operationId: event.payload.operationId,
    workOrderId: event.payload.workOrderId,
    status: isStart ? 'active' : 'completed',
    startedAt: event.ts,
    endedAt: isStart ? undefined : event.ts,
    lastActivity: event.ts,
    isPinned: false,
    metadata: {
      turnId: event.id,
    },
  }
}

/**
 * Create a tool call graph node.
 */
function createToolCallNode(event: GatewayEvent): GraphNode {
  const isStart = event.kind === 'gw.tool.start'
  const status = isStart
    ? 'active'
    : event.payload.exitCode === 0 || event.payload.exitCode === undefined
      ? 'completed'
      : 'failed'

  return {
    id: `tool:${event.sessionId}:${event.payload.toolName || 'unknown'}:${event.id}`,
    kind: 'tool_call',
    sessionId: event.sessionId,
    sessionKey: event.sessionKey,
    agentId: event.agentId,
    operationId: event.payload.operationId,
    workOrderId: event.payload.workOrderId,
    status,
    startedAt: event.ts,
    endedAt: isStart ? undefined : event.ts,
    lastActivity: event.ts,
    isPinned: false,
    metadata: {
      toolName: event.payload.toolName,
      durationMs: event.payload.durationMs,
      exitCode: event.payload.exitCode,
    },
  }
}

/**
 * Create an assistant output graph node.
 */
function createAssistantNode(event: GatewayEvent): GraphNode {
  return {
    id: `assistant:${event.sessionId}:${event.id}`,
    kind: 'assistant',
    sessionId: event.sessionId,
    sessionKey: event.sessionKey,
    agentId: event.agentId,
    operationId: event.payload.operationId,
    workOrderId: event.payload.workOrderId,
    status: 'completed',
    startedAt: event.ts,
    lastActivity: event.ts,
    isPinned: false,
    metadata: {},
  }
}

/**
 * Create a graph edge.
 */
function createEdge(
  sourceId: string,
  targetId: string,
  kind: GraphEdgeKind,
  confidence: EdgeConfidence
): GraphEdge {
  return {
    id: `edge:${sourceId}:${targetId}:${kind}`,
    kind,
    sourceId,
    targetId,
    createdAt: new Date(),
    confidence,
  }
}

/**
 * Create a spawn edge between parent and child sessions.
 */
export function createSpawnEdge(
  parentId: string,
  childId: string,
  confidence: EdgeConfidence
): GraphEdge {
  return createEdge(parentId, childId, 'spawned', confidence)
}

/**
 * Check if an event represents a potential subagent spawn.
 */
export function isSubagentEvent(event: GatewayEvent): boolean {
  return event.payload.isSubagent === true
}
