'use client'

import { useReducer, useCallback, useEffect, useMemo } from 'react'
import type {
  GraphNode,
  GraphEdge,
  GraphSnapshot,
  GraphDelta,
  GraphNodeKind,
  MirrorStatus,
} from '@/lib/openclaw/live-graph'
import type { GatewayConnectionState } from './use-gateway-stream'

// ============================================================================
// Types
// ============================================================================

export interface GatewayGraphFilters {
  nodeKinds: Set<GraphNodeKind>
  agentIds: Set<string>
  sessionKeyPattern: string | null
  activeOnly: boolean
}

export interface GatewayGraphState {
  // Graph data
  nodes: Map<string, GraphNode>
  edges: Map<string, GraphEdge>

  // Connection
  connectionState: GatewayConnectionState
  mirrorStatus: MirrorStatus | null

  // Metrics
  lastEventId: string | null
  eventsPerSecond: number
  eventCountWindow: number[]

  // UI state
  filters: GatewayGraphFilters
  selectedNodeId: string | null
  highlightedNodeIds: Set<string>
  paused: boolean
}

// ============================================================================
// Actions
// ============================================================================

export type GatewayGraphAction =
  | { type: 'SNAPSHOT_RECEIVED'; snapshot: GraphSnapshot }
  | { type: 'DELTA_RECEIVED'; delta: GraphDelta }
  | { type: 'CONNECTION_STATE_CHANGED'; state: GatewayConnectionState }
  | { type: 'MIRROR_STATUS_RECEIVED'; status: MirrorStatus }
  | { type: 'SET_FILTER'; filter: Partial<GatewayGraphFilters> }
  | { type: 'SELECT_NODE'; nodeId: string | null }
  | { type: 'HIGHLIGHT_NODES'; nodeIds: string[] }
  | { type: 'CLEAR_HIGHLIGHTS' }
  | { type: 'TOGGLE_PAUSE' }
  | { type: 'TICK_EVENT_COUNTER' }

// ============================================================================
// Initial State
// ============================================================================

const ALL_NODE_KINDS: GraphNodeKind[] = ['chat', 'session', 'turn', 'tool_call', 'assistant']

export function createInitialState(): GatewayGraphState {
  return {
    nodes: new Map(),
    edges: new Map(),
    connectionState: 'disconnected',
    mirrorStatus: null,
    lastEventId: null,
    eventsPerSecond: 0,
    eventCountWindow: [],
    filters: {
      nodeKinds: new Set(ALL_NODE_KINDS),
      agentIds: new Set(),
      sessionKeyPattern: null,
      activeOnly: false,
    },
    selectedNodeId: null,
    highlightedNodeIds: new Set(),
    paused: false,
  }
}

// ============================================================================
// Reducer
// ============================================================================

function gatewayGraphReducer(
  state: GatewayGraphState,
  action: GatewayGraphAction
): GatewayGraphState {
  switch (action.type) {
    case 'SNAPSHOT_RECEIVED': {
      const { snapshot } = action
      const nodes = new Map<string, GraphNode>()
      const edges = new Map<string, GraphEdge>()

      for (const node of snapshot.nodes) {
        nodes.set(node.id, node)
      }
      for (const edge of snapshot.edges) {
        edges.set(edge.id, edge)
      }

      return {
        ...state,
        nodes,
        edges,
        lastEventId: snapshot.lastEventId,
      }
    }

    case 'DELTA_RECEIVED': {
      if (state.paused) return state

      const { delta } = action
      const nodes = new Map(state.nodes)
      const edges = new Map(state.edges)

      // Add/update nodes
      for (const node of delta.addedNodes) {
        nodes.set(node.id, node)
      }
      for (const node of delta.updatedNodes) {
        const existing = nodes.get(node.id)
        nodes.set(node.id, { ...existing, ...node })
      }

      // Remove nodes
      for (const nodeId of delta.removedNodeIds) {
        nodes.delete(nodeId)
      }

      // Add edges
      for (const edge of delta.addedEdges) {
        edges.set(edge.id, edge)
      }

      // Remove edges
      for (const edgeId of delta.removedEdgeIds) {
        edges.delete(edgeId)
      }

      // Record event for rate calculation
      const eventCountWindow = [...state.eventCountWindow, Date.now()]

      return {
        ...state,
        nodes,
        edges,
        lastEventId: delta.lastEventId,
        eventCountWindow,
      }
    }

    case 'CONNECTION_STATE_CHANGED':
      return {
        ...state,
        connectionState: action.state,
      }

    case 'MIRROR_STATUS_RECEIVED':
      return {
        ...state,
        mirrorStatus: action.status,
      }

    case 'SET_FILTER':
      return {
        ...state,
        filters: {
          ...state.filters,
          ...action.filter,
        },
      }

    case 'SELECT_NODE':
      return {
        ...state,
        selectedNodeId: action.nodeId,
      }

    case 'HIGHLIGHT_NODES':
      return {
        ...state,
        highlightedNodeIds: new Set(action.nodeIds),
      }

    case 'CLEAR_HIGHLIGHTS':
      return {
        ...state,
        highlightedNodeIds: new Set(),
      }

    case 'TOGGLE_PAUSE':
      return {
        ...state,
        paused: !state.paused,
      }

    case 'TICK_EVENT_COUNTER': {
      const now = Date.now()
      const windowMs = 10_000 // 10 second window
      const recentEvents = state.eventCountWindow.filter((ts) => ts > now - windowMs)
      const eventsPerSecond = Math.round((recentEvents.length / (windowMs / 1000)) * 10) / 10

      return {
        ...state,
        eventCountWindow: recentEvents,
        eventsPerSecond,
      }
    }

    default:
      return state
  }
}

// ============================================================================
// Hook
// ============================================================================

export function useGatewayGraphStore() {
  const [state, dispatch] = useReducer(gatewayGraphReducer, null, createInitialState)

  // Tick event counter every second
  useEffect(() => {
    const interval = setInterval(() => {
      dispatch({ type: 'TICK_EVENT_COUNTER' })
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  // Action creators
  const handleSnapshot = useCallback((snapshot: GraphSnapshot) => {
    dispatch({ type: 'SNAPSHOT_RECEIVED', snapshot })
  }, [])

  const handleDelta = useCallback((delta: GraphDelta) => {
    dispatch({ type: 'DELTA_RECEIVED', delta })
  }, [])

  const handleConnectionChange = useCallback((connectionState: GatewayConnectionState) => {
    dispatch({ type: 'CONNECTION_STATE_CHANGED', state: connectionState })
  }, [])

  const handleMirrorStatus = useCallback((status: MirrorStatus) => {
    dispatch({ type: 'MIRROR_STATUS_RECEIVED', status })
  }, [])

  const setFilter = useCallback((filter: Partial<GatewayGraphFilters>) => {
    dispatch({ type: 'SET_FILTER', filter })
  }, [])

  const selectNode = useCallback((nodeId: string | null) => {
    dispatch({ type: 'SELECT_NODE', nodeId })
  }, [])

  const highlightNodes = useCallback((nodeIds: string[]) => {
    dispatch({ type: 'HIGHLIGHT_NODES', nodeIds })
  }, [])

  const clearHighlights = useCallback(() => {
    dispatch({ type: 'CLEAR_HIGHLIGHTS' })
  }, [])

  const togglePause = useCallback(() => {
    dispatch({ type: 'TOGGLE_PAUSE' })
  }, [])

  // Filtered data getters
  const getFilteredNodes = useCallback((): GraphNode[] => {
    const { nodes, filters } = state
    let result = Array.from(nodes.values())

    // Filter by node kind
    if (filters.nodeKinds.size < ALL_NODE_KINDS.length) {
      result = result.filter((n) => filters.nodeKinds.has(n.kind))
    }

    // Filter by agent ID
    if (filters.agentIds.size > 0) {
      result = result.filter((n) => n.agentId && filters.agentIds.has(n.agentId))
    }

    // Filter by session key pattern
    if (filters.sessionKeyPattern) {
      const pattern = new RegExp(filters.sessionKeyPattern, 'i')
      result = result.filter((n) => n.sessionKey && pattern.test(n.sessionKey))
    }

    // Filter active only
    if (filters.activeOnly) {
      result = result.filter((n) => n.status === 'active')
    }

    return result
  }, [state])

  const getFilteredEdges = useCallback((): GraphEdge[] => {
    const filteredNodes = getFilteredNodes()
    const nodeIds = new Set(filteredNodes.map((n) => n.id))

    return Array.from(state.edges.values()).filter(
      (e) => nodeIds.has(e.sourceId) && nodeIds.has(e.targetId)
    )
  }, [state.edges, getFilteredNodes])

  // Stats
  const stats = useMemo(() => {
    const activeNodes = Array.from(state.nodes.values()).filter((n) => n.status === 'active')
    const sessions = Array.from(state.nodes.values()).filter((n) => n.kind === 'session')
    const toolCalls = Array.from(state.nodes.values()).filter((n) => n.kind === 'tool_call')

    return {
      totalNodes: state.nodes.size,
      totalEdges: state.edges.size,
      activeNodes: activeNodes.length,
      sessions: sessions.length,
      toolCalls: toolCalls.length,
      eventsPerSecond: state.eventsPerSecond,
    }
  }, [state.nodes, state.edges, state.eventsPerSecond])

  // Get unique agent IDs for filter dropdown
  const uniqueAgentIds = useMemo(() => {
    const ids = new Set<string>()
    for (const node of state.nodes.values()) {
      if (node.agentId) {
        ids.add(node.agentId)
      }
    }
    return Array.from(ids).sort()
  }, [state.nodes])

  // Get selected node details
  const selectedNode = useMemo(() => {
    if (!state.selectedNodeId) return null
    return state.nodes.get(state.selectedNodeId) || null
  }, [state.selectedNodeId, state.nodes])

  return {
    state,
    actions: {
      handleSnapshot,
      handleDelta,
      handleConnectionChange,
      handleMirrorStatus,
      setFilter,
      selectNode,
      highlightNodes,
      clearHighlights,
      togglePause,
    },
    getFilteredNodes,
    getFilteredEdges,
    stats,
    uniqueAgentIds,
    selectedNode,
  }
}
