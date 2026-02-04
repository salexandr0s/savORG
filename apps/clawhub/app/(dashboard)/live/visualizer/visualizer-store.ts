'use client'

import { useReducer, useCallback, useEffect, useRef, useMemo } from 'react'
import type { ActivityDTO } from '@/lib/repo'
import type { SseConnectionState } from '@/lib/hooks/useSseStream'

// ============================================================================
// Types
// ============================================================================

export type VisualizerEntityType = 'work_order' | 'operation' | 'receipt'

/** Execution state: intent → executing → completed/failed */
export type ExecutionState = 'intent' | 'queued' | 'executing' | 'completed' | 'failed'

export interface VisualizerNode {
  id: string
  entityType: VisualizerEntityType
  displayId: string
  title: string
  status: string
  executionState: ExecutionState
  lastActivity: Date
  createdAt: Date
  isPinned: boolean
  isFading: boolean // TTL fade-out state
  // Work order specific
  priority?: string
  runningOpsCount?: number
  pendingOpsCount?: number
  lastReceiptStatus?: 'running' | 'success' | 'failed' | null
  // Operation specific
  workOrderId?: string
  activeReceiptId?: string
  // Receipt specific
  exitCode?: number | null
  durationMs?: number | null
  isRunning?: boolean
  commandName?: string
  operationId?: string
  // Context for display
  workOrderCode?: string
}

export interface VisualizerFilters {
  entityTypes: Set<VisualizerEntityType>
  errorsOnly: boolean
  attentionOnly: boolean
}

export interface AttentionStats {
  failedReceipts: number
  blockedWorkOrders: number
  blockedOperations: number
  stuckOperations: number // Running > 5 minutes
  pendingApprovals: number
  total: number
}

export interface VisualizerState {
  // Node collections
  workOrders: Map<string, VisualizerNode>
  operations: Map<string, VisualizerNode>
  receipts: Map<string, VisualizerNode>

  // Connection & metrics
  connectionState: SseConnectionState
  eventsPerSecond: number
  lastEventTime: Date | null
  eventCountWindow: number[]
  reconnectAttempt: number
  reconnectingIn: number | null // seconds until next reconnect

  // Controls
  tailMode: boolean
  paused: boolean
  filters: VisualizerFilters

  // Selection & highlighting
  selectedNode: { entityType: VisualizerEntityType; id: string } | null
  highlightedNode: { entityType: VisualizerEntityType; id: string } | null
}

// ============================================================================
// Actions
// ============================================================================

export type VisualizerAction =
  | { type: 'ACTIVITY_RECEIVED'; activity: ActivityDTO }
  | { type: 'CONNECTION_STATE_CHANGED'; state: SseConnectionState }
  | { type: 'RECONNECT_TICK'; attempt: number; secondsRemaining: number | null }
  | { type: 'TOGGLE_TAIL_MODE' }
  | { type: 'TOGGLE_PAUSE' }
  | { type: 'SET_FILTER'; filter: Partial<VisualizerFilters> }
  | { type: 'SELECT_NODE'; node: { entityType: VisualizerEntityType; id: string } | null }
  | { type: 'HIGHLIGHT_NODE'; node: { entityType: VisualizerEntityType; id: string } | null }
  | { type: 'PIN_NODE'; entityType: VisualizerEntityType; id: string }
  | { type: 'UNPIN_NODE'; entityType: VisualizerEntityType; id: string }
  | { type: 'EXPIRE_OLD_NODES' }
  | { type: 'TICK_EVENT_COUNTER' }
  | { type: 'MARK_FADING'; entityType: VisualizerEntityType; id: string }

// ============================================================================
// Constants
// ============================================================================

const NODE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const FADE_BEFORE_TTL_MS = 60 * 1000 // Start fading 1 minute before expiry
const STUCK_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes = "stuck"
const MAX_NODES_PER_LANE = 20
const EVENT_WINDOW_SECONDS = 10

// ============================================================================
// Initial State
// ============================================================================

export function createInitialState(): VisualizerState {
  return {
    workOrders: new Map(),
    operations: new Map(),
    receipts: new Map(),
    connectionState: 'disconnected',
    eventsPerSecond: 0,
    lastEventTime: null,
    eventCountWindow: [],
    reconnectAttempt: 0,
    reconnectingIn: null,
    tailMode: true,
    paused: false,
    filters: {
      entityTypes: new Set(['work_order', 'operation', 'receipt']),
      errorsOnly: false,
      attentionOnly: false,
    },
    selectedNode: null,
    highlightedNode: null,
  }
}

// ============================================================================
// Helpers
// ============================================================================

function getExecutionState(entityType: VisualizerEntityType, status: string, payload: Record<string, unknown>): ExecutionState {
  if (entityType === 'work_order') {
    switch (status) {
      case 'planned': return 'intent'
      case 'active': return 'executing'
      case 'blocked': return 'failed'
      case 'review': return 'queued'
      case 'shipped': return 'completed'
      case 'cancelled': return 'failed'
      default: return 'intent'
    }
  }
  if (entityType === 'operation') {
    switch (status) {
      case 'todo': return 'intent'
      case 'in_progress': return 'executing'
      case 'blocked': return 'failed'
      case 'review': return 'queued'
      case 'done': return 'completed'
      case 'rework': return 'queued'
      default: return 'intent'
    }
  }
  if (entityType === 'receipt') {
    const exitCode = payload.exitCode as number | null | undefined
    if (exitCode === undefined || exitCode === null) {
      return status === 'running' ? 'executing' : 'queued'
    }
    return exitCode === 0 ? 'completed' : 'failed'
  }
  return 'intent'
}

function shouldExpireNode(node: VisualizerNode, now: Date): boolean {
  if (node.isPinned) return false
  if (node.entityType === 'receipt' && node.isRunning) return false
  if (node.entityType === 'work_order' && node.status === 'active') return false
  if (node.entityType === 'operation' && node.status === 'in_progress') return false

  const age = now.getTime() - node.lastActivity.getTime()
  return age > NODE_TTL_MS
}

function shouldFadeNode(node: VisualizerNode, now: Date): boolean {
  if (node.isPinned) return false
  if (node.entityType === 'receipt' && node.isRunning) return false
  if (node.entityType === 'work_order' && node.status === 'active') return false
  if (node.entityType === 'operation' && node.status === 'in_progress') return false

  const age = now.getTime() - node.lastActivity.getTime()
  return age > (NODE_TTL_MS - FADE_BEFORE_TTL_MS)
}

function needsAttention(node: VisualizerNode, now: Date): boolean {
  // Failed receipts
  if (node.entityType === 'receipt' && node.exitCode !== null && node.exitCode !== 0) {
    return true
  }
  // Blocked work orders
  if (node.entityType === 'work_order' && node.status === 'blocked') {
    return true
  }
  // Blocked or stuck operations
  if (node.entityType === 'operation') {
    if (node.status === 'blocked') return true
    // Stuck = running > 5 minutes
    if (node.status === 'in_progress') {
      const age = now.getTime() - node.createdAt.getTime()
      if (age > STUCK_THRESHOLD_MS) return true
    }
  }
  return false
}

export function isErrorStatus(node: VisualizerNode): boolean {
  if (node.entityType === 'receipt') {
    return node.exitCode !== null && node.exitCode !== 0
  }
  if (node.entityType === 'work_order') {
    return node.status === 'blocked'
  }
  if (node.entityType === 'operation') {
    return node.status === 'blocked' || node.status === 'rework'
  }
  return false
}

function trimMap<T>(map: Map<string, T>, maxSize: number): Map<string, T> {
  if (map.size <= maxSize) return map
  const entries = Array.from(map.entries())
  return new Map(entries.slice(-maxSize))
}

function extractWorkOrderNode(activity: ActivityDTO, existing?: VisualizerNode): Partial<VisualizerNode> {
  const payload = activity.payloadJson as Record<string, unknown>
  const status = (payload.state as string) || (payload.newState as string) || 'active'

  return {
    id: activity.entityId,
    entityType: 'work_order',
    displayId: (payload.code as string) || existing?.displayId || `WO-${activity.entityId.slice(0, 6)}`,
    title: (payload.title as string) || existing?.title || activity.summary,
    status,
    executionState: getExecutionState('work_order', status, payload),
    priority: (payload.priority as string) || existing?.priority,
    lastActivity: activity.ts,
    createdAt: existing?.createdAt || activity.ts,
  }
}

function extractOperationNode(activity: ActivityDTO, existing?: VisualizerNode): Partial<VisualizerNode> {
  const payload = activity.payloadJson as Record<string, unknown>
  const status = (payload.status as string) || (payload.newStatus as string) || 'in_progress'

  return {
    id: activity.entityId,
    entityType: 'operation',
    displayId: existing?.displayId || `OP-${activity.entityId.slice(0, 6)}`,
    title: (payload.title as string) || existing?.title || activity.summary,
    status,
    executionState: getExecutionState('operation', status, payload),
    workOrderId: (payload.workOrderId as string) || existing?.workOrderId,
    workOrderCode: (payload.workOrderCode as string) || existing?.workOrderCode,
    lastActivity: activity.ts,
    createdAt: existing?.createdAt || activity.ts,
  }
}

function extractReceiptNode(activity: ActivityDTO, existing?: VisualizerNode): Partial<VisualizerNode> {
  const payload = activity.payloadJson as Record<string, unknown>
  const activityType = activity.type

  const isFinalized = activityType === 'receipt.finalized'
  const isStarted = activityType === 'receipt.started' || activityType === 'receipt.created'
  const status = isFinalized ? 'completed' : 'running'

  return {
    id: activity.entityId,
    entityType: 'receipt',
    displayId: existing?.displayId || activity.entityId.slice(0, 8),
    title: (payload.commandName as string) || existing?.title || activity.summary,
    status,
    executionState: getExecutionState('receipt', status, payload),
    commandName: (payload.commandName as string) || existing?.commandName,
    exitCode: isFinalized ? (payload.exitCode as number) : existing?.exitCode ?? null,
    durationMs: isFinalized ? (payload.durationMs as number) : existing?.durationMs ?? null,
    isRunning: !isFinalized && (isStarted || !(payload.exitCode)),
    workOrderId: (payload.workOrderId as string) || existing?.workOrderId,
    operationId: (payload.operationId as string) || existing?.operationId,
    workOrderCode: (payload.workOrderCode as string) || existing?.workOrderCode,
    lastActivity: activity.ts,
    createdAt: existing?.createdAt || activity.ts,
  }
}

// Update correlations: WO running/pending counts, last receipt status
function updateCorrelations(state: VisualizerState): VisualizerState {
  const workOrders = new Map(state.workOrders)
  const operations = new Map(state.operations)

  // Count running ops per work order
  const woOpsCount = new Map<string, { running: number; pending: number }>()
  const woLastReceipt = new Map<string, 'running' | 'success' | 'failed' | null>()

  for (const op of operations.values()) {
    if (op.workOrderId) {
      const counts = woOpsCount.get(op.workOrderId) || { running: 0, pending: 0 }
      if (op.status === 'in_progress') counts.running++
      if (op.status === 'todo' || op.status === 'review') counts.pending++
      woOpsCount.set(op.workOrderId, counts)
    }
  }

  // Find last receipt status per work order
  for (const receipt of state.receipts.values()) {
    if (receipt.workOrderId) {
      const existing = woLastReceipt.get(receipt.workOrderId)
      if (!existing || receipt.lastActivity > (workOrders.get(receipt.workOrderId)?.lastActivity || new Date(0))) {
        if (receipt.isRunning) {
          woLastReceipt.set(receipt.workOrderId, 'running')
        } else if (receipt.exitCode === 0) {
          woLastReceipt.set(receipt.workOrderId, 'success')
        } else if (receipt.exitCode !== null) {
          woLastReceipt.set(receipt.workOrderId, 'failed')
        }
      }
    }
  }

  // Find active receipt per operation
  for (const receipt of state.receipts.values()) {
    if (receipt.operationId && receipt.isRunning) {
      const op = operations.get(receipt.operationId)
      if (op) {
        operations.set(receipt.operationId, { ...op, activeReceiptId: receipt.id })
      }
    }
  }

  // Apply to work orders
  for (const [id, wo] of workOrders) {
    const counts = woOpsCount.get(id)
    const lastReceipt = woLastReceipt.get(id)
    workOrders.set(id, {
      ...wo,
      runningOpsCount: counts?.running || 0,
      pendingOpsCount: counts?.pending || 0,
      lastReceiptStatus: lastReceipt || null,
    })
  }

  return { ...state, workOrders, operations }
}

// ============================================================================
// Reducer
// ============================================================================

export function visualizerReducer(
  state: VisualizerState,
  action: VisualizerAction
): VisualizerState {
  switch (action.type) {
    case 'ACTIVITY_RECEIVED': {
      if (state.paused) return state

      const { activity } = action
      const entityType = activity.entityType as VisualizerEntityType

      // Record event timestamp for events/sec calculation
      const eventCountWindow = [...state.eventCountWindow, Date.now()]

      // Process by entity type
      let workOrders = state.workOrders
      let operations = state.operations
      let receipts = state.receipts

      if (entityType === 'work_order') {
        const existing = workOrders.get(activity.entityId)
        const nodeData = extractWorkOrderNode(activity, existing)
        const node: VisualizerNode = {
          isPinned: existing?.isPinned ?? false,
          isFading: false,
          ...existing,
          ...nodeData,
        } as VisualizerNode
        workOrders = new Map(workOrders)
        workOrders.set(activity.entityId, node)
        workOrders = trimMap(workOrders, MAX_NODES_PER_LANE)
      } else if (entityType === 'operation') {
        const existing = operations.get(activity.entityId)
        const nodeData = extractOperationNode(activity, existing)
        const node: VisualizerNode = {
          isPinned: existing?.isPinned ?? false,
          isFading: false,
          ...existing,
          ...nodeData,
        } as VisualizerNode
        operations = new Map(operations)
        operations.set(activity.entityId, node)
        operations = trimMap(operations, MAX_NODES_PER_LANE)
      } else if (entityType === 'receipt') {
        const existing = receipts.get(activity.entityId)
        const nodeData = extractReceiptNode(activity, existing)
        const node: VisualizerNode = {
          isPinned: existing?.isPinned ?? (nodeData.isRunning ?? false), // Auto-pin running receipts
          isFading: false,
          ...existing,
          ...nodeData,
        } as VisualizerNode
        receipts = new Map(receipts)
        receipts.set(activity.entityId, node)
        receipts = trimMap(receipts, MAX_NODES_PER_LANE)
      }

      // Update correlations after processing
      const newState = updateCorrelations({
        ...state,
        workOrders,
        operations,
        receipts,
        lastEventTime: activity.ts,
        eventCountWindow,
      })

      return newState
    }

    case 'CONNECTION_STATE_CHANGED':
      return {
        ...state,
        connectionState: action.state,
        reconnectAttempt: action.state === 'connected' ? 0 : state.reconnectAttempt,
        reconnectingIn: action.state === 'connected' ? null : state.reconnectingIn,
      }

    case 'RECONNECT_TICK':
      return {
        ...state,
        reconnectAttempt: action.attempt,
        reconnectingIn: action.secondsRemaining,
      }

    case 'TOGGLE_TAIL_MODE':
      return {
        ...state,
        tailMode: !state.tailMode,
      }

    case 'TOGGLE_PAUSE':
      return {
        ...state,
        paused: !state.paused,
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
        selectedNode: action.node,
      }

    case 'HIGHLIGHT_NODE':
      return {
        ...state,
        highlightedNode: action.node,
      }

    case 'PIN_NODE': {
      const { entityType, id } = action
      const collection =
        entityType === 'work_order'
          ? state.workOrders
          : entityType === 'operation'
            ? state.operations
            : state.receipts

      const node = collection.get(id)
      if (!node) return state

      const updatedCollection = new Map(collection)
      updatedCollection.set(id, { ...node, isPinned: true, isFading: false })

      return {
        ...state,
        [entityType === 'work_order'
          ? 'workOrders'
          : entityType === 'operation'
            ? 'operations'
            : 'receipts']: updatedCollection,
      }
    }

    case 'UNPIN_NODE': {
      const { entityType, id } = action
      const collection =
        entityType === 'work_order'
          ? state.workOrders
          : entityType === 'operation'
            ? state.operations
            : state.receipts

      const node = collection.get(id)
      if (!node) return state

      const updatedCollection = new Map(collection)
      updatedCollection.set(id, { ...node, isPinned: false })

      return {
        ...state,
        [entityType === 'work_order'
          ? 'workOrders'
          : entityType === 'operation'
            ? 'operations'
            : 'receipts']: updatedCollection,
      }
    }

    case 'MARK_FADING': {
      const { entityType, id } = action
      const collection =
        entityType === 'work_order'
          ? state.workOrders
          : entityType === 'operation'
            ? state.operations
            : state.receipts

      const node = collection.get(id)
      if (!node) return state

      const updatedCollection = new Map(collection)
      updatedCollection.set(id, { ...node, isFading: true })

      return {
        ...state,
        [entityType === 'work_order'
          ? 'workOrders'
          : entityType === 'operation'
            ? 'operations'
            : 'receipts']: updatedCollection,
      }
    }

    case 'EXPIRE_OLD_NODES': {
      const now = new Date()

      const processMap = (map: Map<string, VisualizerNode>) => {
        const result = new Map<string, VisualizerNode>()
        for (const [id, node] of map) {
          if (shouldExpireNode(node, now)) {
            // Don't add - expired
            continue
          }
          // Check if should start fading
          if (!node.isFading && shouldFadeNode(node, now)) {
            result.set(id, { ...node, isFading: true })
          } else {
            result.set(id, node)
          }
        }
        return result
      }

      return {
        ...state,
        workOrders: processMap(state.workOrders),
        operations: processMap(state.operations),
        receipts: processMap(state.receipts),
      }
    }

    case 'TICK_EVENT_COUNTER': {
      const now = Date.now()
      const windowStart = now - EVENT_WINDOW_SECONDS * 1000

      // Filter out old timestamps
      const recentEvents = state.eventCountWindow.filter((ts) => ts > windowStart)

      // Calculate rate
      const eventsPerSecond = Math.round((recentEvents.length / EVENT_WINDOW_SECONDS) * 10) / 10

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

export function useVisualizerStore() {
  const [state, dispatch] = useReducer(visualizerReducer, null, createInitialState)
  const highlightTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Set up periodic expiration and event counter
  useEffect(() => {
    // Tick event counter every second
    const tickInterval = setInterval(() => {
      dispatch({ type: 'TICK_EVENT_COUNTER' })
    }, 1000)

    // Expire old nodes every 30 seconds
    const expireInterval = setInterval(() => {
      dispatch({ type: 'EXPIRE_OLD_NODES' })
    }, 30000)

    return () => {
      clearInterval(tickInterval)
      clearInterval(expireInterval)
    }
  }, [])

  // Action creators
  const handleActivity = useCallback((activity: ActivityDTO) => {
    dispatch({ type: 'ACTIVITY_RECEIVED', activity })
  }, [])

  const handleConnectionChange = useCallback((connectionState: SseConnectionState) => {
    dispatch({ type: 'CONNECTION_STATE_CHANGED', state: connectionState })
  }, [])

  const setReconnectStatus = useCallback((attempt: number, secondsRemaining: number | null) => {
    dispatch({ type: 'RECONNECT_TICK', attempt, secondsRemaining })
  }, [])

  const toggleTailMode = useCallback(() => {
    dispatch({ type: 'TOGGLE_TAIL_MODE' })
  }, [])

  const togglePause = useCallback(() => {
    dispatch({ type: 'TOGGLE_PAUSE' })
  }, [])

  const setFilter = useCallback((filter: Partial<VisualizerFilters>) => {
    dispatch({ type: 'SET_FILTER', filter })
  }, [])

  const selectNode = useCallback(
    (node: { entityType: VisualizerEntityType; id: string } | null) => {
      dispatch({ type: 'SELECT_NODE', node })
    },
    []
  )

  // Highlight a node briefly (for correlation jumps)
  const highlightNode = useCallback(
    (node: { entityType: VisualizerEntityType; id: string } | null, durationMs = 1500) => {
      // Clear any existing timeout
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current)
      }

      dispatch({ type: 'HIGHLIGHT_NODE', node })

      if (node) {
        highlightTimeoutRef.current = setTimeout(() => {
          dispatch({ type: 'HIGHLIGHT_NODE', node: null })
        }, durationMs)
      }
    },
    []
  )

  const pinNode = useCallback((entityType: VisualizerEntityType, id: string) => {
    dispatch({ type: 'PIN_NODE', entityType, id })
  }, [])

  const unpinNode = useCallback((entityType: VisualizerEntityType, id: string) => {
    dispatch({ type: 'UNPIN_NODE', entityType, id })
  }, [])

  // Get attention stats
  const getAttentionStats = useCallback((): AttentionStats => {
    const now = new Date()
    let failedReceipts = 0
    let blockedWorkOrders = 0
    let blockedOperations = 0
    let stuckOperations = 0

    for (const receipt of state.receipts.values()) {
      if (receipt.exitCode !== null && receipt.exitCode !== 0) {
        failedReceipts++
      }
    }

    for (const wo of state.workOrders.values()) {
      if (wo.status === 'blocked') {
        blockedWorkOrders++
      }
    }

    for (const op of state.operations.values()) {
      if (op.status === 'blocked') {
        blockedOperations++
      }
      if (op.status === 'in_progress') {
        const age = now.getTime() - op.createdAt.getTime()
        if (age > STUCK_THRESHOLD_MS) {
          stuckOperations++
        }
      }
    }

    return {
      failedReceipts,
      blockedWorkOrders,
      blockedOperations,
      stuckOperations,
      pendingApprovals: 0, // Would need approvals data
      total: failedReceipts + blockedWorkOrders + blockedOperations + stuckOperations,
    }
  }, [state.receipts, state.workOrders, state.operations])

  // Filtered nodes
  const getFilteredNodes = useCallback(() => {
    const { filters, workOrders, operations, receipts } = state
    const now = new Date()

    const filterNodes = (nodes: Map<string, VisualizerNode>, type: VisualizerEntityType) => {
      if (!filters.entityTypes.has(type)) return []

      let arr = Array.from(nodes.values())

      if (filters.errorsOnly) {
        arr = arr.filter(isErrorStatus)
      }

      if (filters.attentionOnly) {
        arr = arr.filter((node) => needsAttention(node, now))
      }

      return arr
    }

    return {
      workOrders: filterNodes(workOrders, 'work_order'),
      operations: filterNodes(operations, 'operation'),
      receipts: filterNodes(receipts, 'receipt'),
    }
  }, [state])

  // Check if system is quiet (no events for a while)
  const quietStatus = useMemo(() => {
    if (!state.lastEventTime) {
      return { isQuiet: true, lastEventAgo: null }
    }

    const now = new Date()
    const ageMs = now.getTime() - state.lastEventTime.getTime()
    const isQuiet = ageMs > 60000 // Quiet if no events for 1 minute

    return {
      isQuiet,
      lastEventAgo: ageMs,
    }
  }, [state.lastEventTime])

  // Summary stats for quiet mode
  const summaryStats = useMemo(() => {
    let running = 0
    let pending = 0
    let blocked = 0

    for (const receipt of state.receipts.values()) {
      if (receipt.isRunning) running++
    }
    for (const op of state.operations.values()) {
      if (op.status === 'in_progress') running++
      if (op.status === 'todo' || op.status === 'review') pending++
      if (op.status === 'blocked') blocked++
    }
    for (const wo of state.workOrders.values()) {
      if (wo.status === 'blocked') blocked++
    }

    return { running, pending, blocked }
  }, [state.receipts, state.operations, state.workOrders])

  return {
    state,
    actions: {
      handleActivity,
      handleConnectionChange,
      setReconnectStatus,
      toggleTailMode,
      togglePause,
      setFilter,
      selectNode,
      highlightNode,
      pinNode,
      unpinNode,
    },
    getFilteredNodes,
    getAttentionStats,
    quietStatus,
    summaryStats,
  }
}
