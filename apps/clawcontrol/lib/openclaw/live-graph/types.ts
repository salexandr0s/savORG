/**
 * Gateway Live Graph Types
 *
 * Types for the Crabwalk-style live visualization of OpenClaw agent activity.
 * Follows the Gateway WebSocket protocol documented in the plan.
 */

// ============================================================================
// RAW GATEWAY FRAMES (from WebSocket)
// ============================================================================

/**
 * Raw frame from the Gateway WebSocket.
 * Gateway protocol uses { type, event, payload } structure.
 */
export interface GatewayRawFrame {
  type: 'event' | 'response' | 'error'
  event?: GatewayFrameEvent
  payload?: GatewayFramePayload
  /** Response/error fields */
  id?: string
  result?: unknown
  error?: { code: number; message: string }
}

export type GatewayFrameEvent =
  | 'connect.challenge'
  | 'connect.ack'
  | 'chat'
  | 'agent'
  | 'exec.started'
  | 'exec.output'
  | 'exec.completed'
  | 'health'
  | 'tick'

export interface GatewayFramePayload {
  sessionKey?: string
  sessionId?: string
  agentId?: string
  stream?: 'lifecycle' | 'assistant'
  type?: 'tool_use' | 'tool_result'
  phase?: 'start' | 'end'
  tool?: string
  toolName?: string
  // Tool args are present in raw data but MUST be redacted before storage/emission
  args?: unknown
  result?: unknown
  content?: string
  channel?: string
  messageId?: string
  exitCode?: number
  durationMs?: number
  startedAt?: string
  endedAt?: string
  // Challenge payload
  nonce?: string
  // Additional fields may exist - we ignore unknown fields
  [key: string]: unknown
}

/**
 * Legacy alias for backward compatibility in event-normalizer
 */
export interface GatewayFrame {
  event: GatewayFrameEvent
  data?: GatewayFramePayload
}

/**
 * Legacy alias
 */
export type GatewayFrameData = GatewayFramePayload

// ============================================================================
// CONNECTION HANDSHAKE (Crabwalk Protocol)
// ============================================================================

/**
 * Request frame sent to Gateway.
 * Protocol: { type: "req", id: "...", method: "...", params: {...} }
 */
export interface GatewayRequest {
  type: 'req'
  id: string
  method: string
  params?: Record<string, unknown>
}

/**
 * Client identification for connect request.
 * Gateway validates that client.id matches expected values.
 */
export interface GatewayClientInfo {
  id: string       // e.g., "clawcontrol", "crabwalk", "cli"
  version: string  // e.g., "0.1.0"
  platform: string // e.g., "darwin", "linux", "win32"
  mode: string     // e.g., "operator", "client"
}

/**
 * Connect request parameters - must match gateway schema exactly.
 * Based on Crabwalk/OpenClaw gateway protocol.
 */
export interface ConnectParams {
  minProtocol: number  // Minimum protocol version supported (e.g., 3)
  maxProtocol: number  // Maximum protocol version supported (e.g., 3)
  client: GatewayClientInfo
  role: 'operator' | 'client'
  scopes: string[]
  auth?: { token: string }
}

/**
 * Legacy ConnectRequest for backward compat
 * @deprecated Use GatewayRequest with method='connect' instead
 */
export interface ConnectRequest {
  req: 'connect'
  role: 'operator'
  scopes: string[]
  auth?: { token: string }
}

// ============================================================================
// NORMALIZED INTERNAL EVENTS (after redaction)
// ============================================================================

export type GatewayEventKind =
  | 'gw.chat'        // Platform message (from chat event)
  | 'gw.turn.start'  // From agent lifecycle stream, phase: start
  | 'gw.turn.end'    // From agent lifecycle stream, phase: end
  | 'gw.tool.start'  // From tool_use or exec.started
  | 'gw.tool.end'    // From tool_result or exec.completed
  | 'gw.spawn'       // Detected via sessionKey.includes("subagent")
  | 'gw.assistant'   // Assistant text output (agent stream: assistant)
  // NOTE: No "delivery" kind until explicit channel/destination evidence

/**
 * Source information preserved for debugging and Crabwalk parity.
 */
export interface GatewayEventSource {
  event: GatewayFrameEvent
  stream?: 'lifecycle' | 'assistant'
  dataType?: 'tool_use' | 'tool_result'
}

/**
 * Normalized gateway event after redaction.
 * This is what gets stored and sent to clients.
 */
export interface GatewayEvent {
  id: string
  kind: GatewayEventKind
  ts: Date
  sessionId: string
  sessionKey: string
  agentId: string

  /** Raw source for debugging + Crabwalk parity */
  source: GatewayEventSource

  payload: GatewayEventPayload
}

export interface GatewayEventPayload {
  /** Parsed from sessionKey :op: token */
  operationId?: string
  /** Parsed from sessionKey :wo: token */
  workOrderId?: string
  /** Tool name only - args REDACTED */
  toolName?: string
  toolStatus?: 'started' | 'completed' | 'failed'
  durationMs?: number
  exitCode?: number
  /** For spawn edges */
  parentSessionId?: string
  childSessionId?: string
  /** Only if explicit evidence exists */
  channel?: string
  messageId?: string
  /** Detected from sessionKey */
  isSubagent?: boolean
}

// ============================================================================
// GRAPH NODES & EDGES
// ============================================================================

export type GraphNodeKind =
  | 'chat'       // Platform message (Crabwalk calls this "CHAT")
  | 'session'    // Agent session
  | 'turn'       // Agent turn (lifecycle start/end)
  | 'tool_call'  // Tool invocation
  | 'assistant'  // Assistant text output
  // NOTE: No 'delivery' until explicit evidence (channel/destination in event)

export type GraphEdgeKind =
  | 'triggered'  // chat -> session
  | 'spawned'    // session -> child session
  | 'used_tool'  // turn -> tool_call
  | 'replied'    // session -> chat (outbound)

export type EdgeConfidence = 'high' | 'medium' | 'low'

export interface GraphNode {
  id: string
  kind: GraphNodeKind
  sessionId?: string
  sessionKey?: string
  agentId?: string
  operationId?: string
  workOrderId?: string
  status: 'active' | 'completed' | 'failed'
  startedAt: Date
  endedAt?: Date
  lastActivity: Date
  isPinned: boolean
  /** Safe metadata only - no secrets */
  metadata: GraphNodeMetadata
}

export interface GraphNodeMetadata {
  // Chat node
  channel?: string
  messageId?: string
  // Tool call node
  toolName?: string
  durationMs?: number
  exitCode?: number
  // Session node
  isSubagent?: boolean
  // Turn node
  turnId?: string
}

export interface GraphEdge {
  id: string
  kind: GraphEdgeKind
  sourceId: string
  targetId: string
  createdAt: Date
  /** For spawn edges especially */
  confidence: EdgeConfidence
}

// ============================================================================
// GRAPH SNAPSHOT & UPDATES
// ============================================================================

export interface GraphSnapshot {
  nodes: GraphNode[]
  edges: GraphEdge[]
  lastEventId: string | null
  ts: Date
}

export interface GraphDelta {
  addedNodes: GraphNode[]
  updatedNodes: GraphNode[]
  removedNodeIds: string[]
  addedEdges: GraphEdge[]
  removedEdgeIds: string[]
  lastEventId: string
}

export interface GraphUpdate {
  type: 'snapshot' | 'delta'
  snapshot?: GraphSnapshot
  delta?: GraphDelta
}

// ============================================================================
// MIRROR SERVICE STATUS
// ============================================================================

export type MirrorMode = 'websocket' | 'polling' | 'disconnected'

export interface MirrorStatus {
  mode: MirrorMode
  connectedAt: Date | null
  lastEventAt: Date | null
  reconnectAttempt: number
  eventCount: number
  nodeCount: number
  edgeCount: number
  gatewayUrl: string
}

// ============================================================================
// CONFIGURATION
// ============================================================================

export interface MirrorConfig {
  /** Gateway WebSocket URL (default: ws://127.0.0.1:18789) */
  gatewayUrl: string
  /** Path to token file (default: ~/.openclaw/openclaw.json) */
  tokenPath?: string
  /** Token from environment variable */
  token?: string
  /** Reconnect delay in ms (default: 3000) */
  reconnectDelayMs: number
  /** Max reconnect attempts before falling back to polling (default: 10) */
  maxReconnectAttempts: number
  /** Polling interval in ms when WS unavailable (default: 5000) */
  pollingIntervalMs: number
  /** Max events to keep in circular buffer (default: 2000) */
  maxEvents: number
  /** Max nodes to keep in graph (default: 500) */
  maxNodes: number
  /** Max edges to keep in graph (default: 800) */
  maxEdges: number
  /** Node TTL in ms (default: 5 * 60 * 1000) */
  nodeTtlMs: number
}

export const DEFAULT_CONFIG: MirrorConfig = {
  gatewayUrl: 'ws://127.0.0.1:18789',
  tokenPath: undefined, // Will default to ~/.openclaw/openclaw.json
  token: undefined,
  reconnectDelayMs: 3000,
  maxReconnectAttempts: 10,
  pollingIntervalMs: 5000,
  maxEvents: 2000,
  maxNodes: 500,
  maxEdges: 800,
  nodeTtlMs: 5 * 60 * 1000, // 5 minutes
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** Time window for subagent spawn inference (ms) */
export const SPAWN_INFERENCE_WINDOW_MS = 10_000

/** Pattern to detect subagent sessions */
export const SUBAGENT_PATTERN = /subagent/i

/** Pattern to extract operation ID from sessionKey */
export const OPERATION_ID_PATTERN = /(?:^|:)op:([a-z0-9]{10,})/i

/** Pattern to extract work order ID from sessionKey */
export const WORK_ORDER_ID_PATTERN = /(?:^|:)wo:([a-z0-9]{10,})/i
