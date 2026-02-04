/**
 * Gateway Live Graph Store
 *
 * Bounded in-memory store for the live graph visualization.
 * Implements rolling window with TTL-based and overflow eviction.
 */

import type {
  GraphNode,
  GraphEdge,
  GraphSnapshot,
  GatewayEvent,
} from './types'

// ============================================================================
// CIRCULAR EVENT BUFFER
// ============================================================================

/**
 * Circular buffer for events with O(1) add and bounded memory.
 */
class CircularEventBuffer {
  private buffer: GatewayEvent[]
  private head = 0
  private size = 0

  constructor(private maxSize: number) {
    this.buffer = new Array(maxSize)
  }

  add(event: GatewayEvent): void {
    this.buffer[this.head] = event
    this.head = (this.head + 1) % this.maxSize
    if (this.size < this.maxSize) {
      this.size++
    }
  }

  getAll(): GatewayEvent[] {
    if (this.size === 0) return []
    if (this.size < this.maxSize) {
      return this.buffer.slice(0, this.size)
    }
    // Full buffer - return in chronological order
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head),
    ]
  }

  getCount(): number {
    return this.size
  }

  clear(): void {
    this.buffer = new Array(this.maxSize)
    this.head = 0
    this.size = 0
  }
}

// ============================================================================
// LIVE GRAPH STORE
// ============================================================================

export interface LiveGraphStoreConfig {
  maxEvents: number
  maxNodes: number
  maxEdges: number
  nodeTtlMs: number
}

export class LiveGraphStore {
  private nodes: Map<string, GraphNode> = new Map()
  private edges: Map<string, GraphEdge> = new Map()
  private events: CircularEventBuffer
  private lastEventId: string | null = null
  private config: LiveGraphStoreConfig

  constructor(config: Partial<LiveGraphStoreConfig> = {}) {
    this.config = {
      maxEvents: config.maxEvents ?? 2000,
      maxNodes: config.maxNodes ?? 500,
      maxEdges: config.maxEdges ?? 800,
      nodeTtlMs: config.nodeTtlMs ?? 5 * 60 * 1000,
    }
    this.events = new CircularEventBuffer(this.config.maxEvents)
  }

  // ==========================================================================
  // NODE OPERATIONS
  // ==========================================================================

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id)
  }

  upsertNode(node: GraphNode): { isNew: boolean; node: GraphNode } {
    const existing = this.nodes.get(node.id)
    const isNew = !existing

    const merged: GraphNode = existing
      ? {
          ...existing,
          ...node,
          // Preserve pin status unless explicitly set
          isPinned: node.isPinned ?? existing.isPinned,
          // Keep earliest startedAt
          startedAt: existing.startedAt < node.startedAt ? existing.startedAt : node.startedAt,
          // Update lastActivity to most recent
          lastActivity: node.lastActivity > existing.lastActivity ? node.lastActivity : existing.lastActivity,
        }
      : node

    this.nodes.set(node.id, merged)

    // Enforce max nodes if overflow
    this.enforceNodeLimit()

    return { isNew, node: merged }
  }

  removeNode(id: string): boolean {
    const deleted = this.nodes.delete(id)
    if (deleted) {
      // Also remove edges connected to this node
      for (const [edgeId, edge] of this.edges) {
        if (edge.sourceId === id || edge.targetId === id) {
          this.edges.delete(edgeId)
        }
      }
    }
    return deleted
  }

  pinNode(id: string): boolean {
    const node = this.nodes.get(id)
    if (!node) return false
    node.isPinned = true
    return true
  }

  unpinNode(id: string): boolean {
    const node = this.nodes.get(id)
    if (!node) return false
    node.isPinned = false
    return true
  }

  // ==========================================================================
  // EDGE OPERATIONS
  // ==========================================================================

  getEdge(id: string): GraphEdge | undefined {
    return this.edges.get(id)
  }

  addEdge(edge: GraphEdge): { isNew: boolean; edge: GraphEdge } {
    const existing = this.edges.get(edge.id)
    if (existing) {
      return { isNew: false, edge: existing }
    }

    this.edges.set(edge.id, edge)

    // Enforce max edges if overflow
    this.enforceEdgeLimit()

    return { isNew: true, edge }
  }

  removeEdge(id: string): boolean {
    return this.edges.delete(id)
  }

  // ==========================================================================
  // EVENT OPERATIONS
  // ==========================================================================

  addEvent(event: GatewayEvent): void {
    this.events.add(event)
    this.lastEventId = event.id
  }

  getLastEventId(): string | null {
    return this.lastEventId
  }

  // ==========================================================================
  // SNAPSHOT & DELTA
  // ==========================================================================

  getSnapshot(): GraphSnapshot {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges.values()),
      lastEventId: this.lastEventId,
      ts: new Date(),
    }
  }

  getStats(): { nodeCount: number; edgeCount: number; eventCount: number } {
    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      eventCount: this.events.getCount(),
    }
  }

  // ==========================================================================
  // EVICTION
  // ==========================================================================

  /**
   * Run TTL-based eviction.
   * Removes nodes older than nodeTtlMs unless pinned or active.
   * Returns IDs of removed nodes.
   */
  evictExpiredNodes(): string[] {
    const now = Date.now()
    const expiredIds: string[] = []

    for (const [id, node] of this.nodes) {
      // Never evict pinned nodes
      if (node.isPinned) continue

      // Never evict active nodes
      if (node.status === 'active') continue

      // Check TTL
      const age = now - node.lastActivity.getTime()
      if (age > this.config.nodeTtlMs) {
        expiredIds.push(id)
      }
    }

    // Remove expired nodes (and their connected edges)
    for (const id of expiredIds) {
      this.removeNode(id)
    }

    return expiredIds
  }

  /**
   * Enforce max node limit via overflow eviction.
   * Evicts oldest inactive, unpinned nodes first.
   */
  private enforceNodeLimit(): void {
    if (this.nodes.size <= this.config.maxNodes) return

    // Collect evictable nodes (not pinned, not active)
    const evictable: { id: string; lastActivity: number }[] = []
    for (const [id, node] of this.nodes) {
      if (!node.isPinned && node.status !== 'active') {
        evictable.push({ id, lastActivity: node.lastActivity.getTime() })
      }
    }

    // Sort by lastActivity ascending (oldest first)
    evictable.sort((a, b) => a.lastActivity - b.lastActivity)

    // Evict oldest until under limit
    const toRemove = this.nodes.size - this.config.maxNodes
    for (let i = 0; i < Math.min(toRemove, evictable.length); i++) {
      this.removeNode(evictable[i].id)
    }
  }

  /**
   * Enforce max edge limit via overflow eviction.
   * Evicts oldest edges first (edges whose nodes are gone or oldest createdAt).
   */
  private enforceEdgeLimit(): void {
    if (this.edges.size <= this.config.maxEdges) return

    // First, remove edges with missing nodes
    const orphanEdges: string[] = []
    for (const [id, edge] of this.edges) {
      if (!this.nodes.has(edge.sourceId) || !this.nodes.has(edge.targetId)) {
        orphanEdges.push(id)
      }
    }
    for (const id of orphanEdges) {
      this.edges.delete(id)
    }

    if (this.edges.size <= this.config.maxEdges) return

    // Still over limit - evict oldest edges
    const edgeList = Array.from(this.edges.entries())
      .map(([id, edge]) => ({ id, createdAt: edge.createdAt.getTime() }))
      .sort((a, b) => a.createdAt - b.createdAt)

    const toRemove = this.edges.size - this.config.maxEdges
    for (let i = 0; i < toRemove; i++) {
      this.edges.delete(edgeList[i].id)
    }
  }

  // ==========================================================================
  // QUERYING
  // ==========================================================================

  /**
   * Get all nodes of a specific kind.
   */
  getNodesByKind(kind: GraphNode['kind']): GraphNode[] {
    const result: GraphNode[] = []
    for (const node of this.nodes.values()) {
      if (node.kind === kind) {
        result.push(node)
      }
    }
    return result
  }

  /**
   * Get all nodes for a specific session.
   */
  getNodesBySession(sessionId: string): GraphNode[] {
    const result: GraphNode[] = []
    for (const node of this.nodes.values()) {
      if (node.sessionId === sessionId) {
        result.push(node)
      }
    }
    return result
  }

  /**
   * Get all edges from/to a specific node.
   */
  getEdgesForNode(nodeId: string): GraphEdge[] {
    const result: GraphEdge[] = []
    for (const edge of this.edges.values()) {
      if (edge.sourceId === nodeId || edge.targetId === nodeId) {
        result.push(edge)
      }
    }
    return result
  }

  /**
   * Get session nodes with recent activity (for parent inference).
   */
  getRecentSessionNodes(withinMs: number): GraphNode[] {
    const cutoff = Date.now() - withinMs
    const result: GraphNode[] = []
    for (const node of this.nodes.values()) {
      if (node.kind === 'session' && node.lastActivity.getTime() > cutoff) {
        result.push(node)
      }
    }
    return result
  }

  /**
   * Find a potential parent session for a subagent.
   * Uses :op:/:wo: token matching first (high confidence),
   * then falls back to time-window inference (lower confidence).
   */
  findParentSession(
    childSessionKey: string,
    childTimestamp: Date
  ): { parentId: string; confidence: 'high' | 'medium' | 'low' } | null {
    // Extract tokens from child session key
    const childOpMatch = childSessionKey.match(/(?:^|:)op:([a-z0-9]{10,})/i)
    const childWoMatch = childSessionKey.match(/(?:^|:)wo:([a-z0-9]{10,})/i)
    const childOpId = childOpMatch?.[1]
    const childWoId = childWoMatch?.[1]

    // First pass: look for token match (high confidence)
    for (const node of this.nodes.values()) {
      if (node.kind !== 'session') continue
      if (node.metadata.isSubagent) continue // Can't be parent if also subagent

      // Match by operation ID
      if (childOpId && node.operationId === childOpId) {
        return { parentId: node.id, confidence: 'high' }
      }
      // Match by work order ID
      if (childWoId && node.workOrderId === childWoId) {
        return { parentId: node.id, confidence: 'high' }
      }
    }

    // Second pass: time-window inference (medium/low confidence)
    const windowMs = 10_000 // 10 seconds
    const cutoff = childTimestamp.getTime() - windowMs

    const candidates: { id: string; lastActivity: number }[] = []
    for (const node of this.nodes.values()) {
      if (node.kind !== 'session') continue
      if (node.metadata.isSubagent) continue

      const activity = node.lastActivity.getTime()
      if (activity > cutoff && activity < childTimestamp.getTime()) {
        candidates.push({ id: node.id, lastActivity: activity })
      }
    }

    if (candidates.length === 0) return null

    // Sort by most recent activity
    candidates.sort((a, b) => b.lastActivity - a.lastActivity)

    // Confidence is medium if subagent pattern present, low otherwise
    const confidence = /subagent/i.test(childSessionKey) ? 'medium' : 'low'

    return { parentId: candidates[0].id, confidence }
  }

  // ==========================================================================
  // CLEAR
  // ==========================================================================

  clear(): void {
    this.nodes.clear()
    this.edges.clear()
    this.events.clear()
    this.lastEventId = null
  }
}
