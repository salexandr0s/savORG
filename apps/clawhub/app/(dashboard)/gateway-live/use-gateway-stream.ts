'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type { GraphSnapshot, GraphDelta, MirrorStatus } from '@/lib/openclaw/live-graph'

export type GatewayConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface UseGatewayStreamOptions {
  /** Filter by agent ID */
  agentId?: string
  /** Filter by sessionKey pattern (e.g., ":op:" or ":wo:") */
  sessionKeyPattern?: string
  /** Filter by channel */
  channel?: string
  /** Called when initial snapshot is received */
  onSnapshot?: (snapshot: GraphSnapshot) => void
  /** Called when delta updates are received */
  onDelta?: (delta: GraphDelta) => void
  /** Called when connection state changes */
  onConnectionChange?: (state: GatewayConnectionState) => void
  /** Called when mirror status is received */
  onMirrorStatus?: (status: MirrorStatus) => void
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean
  /** Max reconnect attempts (default: 10) */
  maxReconnectAttempts?: number
}

export interface UseGatewayStreamReturn {
  connectionState: GatewayConnectionState
  mirrorStatus: MirrorStatus | null
  reconnect: () => void
  disconnect: () => void
}

export function useGatewayStream(options: UseGatewayStreamOptions = {}): UseGatewayStreamReturn {
  const {
    agentId,
    sessionKeyPattern,
    channel,
    onSnapshot,
    onDelta,
    onConnectionChange,
    onMirrorStatus,
    autoReconnect = true,
    maxReconnectAttempts = 10,
  } = options

  const [connectionState, setConnectionState] = useState<GatewayConnectionState>('disconnected')
  const [mirrorStatus, setMirrorStatus] = useState<MirrorStatus | null>(null)

  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  const updateConnectionState = useCallback(
    (state: GatewayConnectionState) => {
      setConnectionState(state)
      onConnectionChange?.(state)
    },
    [onConnectionChange]
  )

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    updateConnectionState('disconnected')
  }, [updateConnectionState])

  const connect = useCallback(() => {
    // Build URL with filters
    const params = new URLSearchParams()
    if (agentId) params.set('agentId', agentId)
    if (sessionKeyPattern) params.set('sessionKey', sessionKeyPattern)
    if (channel) params.set('channel', channel)

    const url = `/api/stream/openclaw${params.toString() ? `?${params.toString()}` : ''}`

    updateConnectionState('connecting')

    const eventSource = new EventSource(url)
    eventSourceRef.current = eventSource

    eventSource.onopen = () => {
      // Will be marked connected after receiving 'connected' event
    }

    eventSource.addEventListener('connected', (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.status) {
          setMirrorStatus(data.status)
          onMirrorStatus?.(data.status)
        }
        reconnectAttemptsRef.current = 0
        updateConnectionState('connected')
      } catch (error) {
        console.error('[GatewayStream] Failed to parse connected event:', error)
      }
    })

    eventSource.addEventListener('snapshot', (event) => {
      try {
        const snapshot = JSON.parse(event.data) as GraphSnapshot
        // Convert date strings back to Date objects
        snapshot.nodes = snapshot.nodes.map((n) => ({
          ...n,
          startedAt: new Date(n.startedAt),
          endedAt: n.endedAt ? new Date(n.endedAt) : undefined,
          lastActivity: new Date(n.lastActivity),
        }))
        snapshot.edges = snapshot.edges.map((e) => ({
          ...e,
          createdAt: new Date(e.createdAt),
        }))
        snapshot.ts = new Date(snapshot.ts)
        onSnapshot?.(snapshot)
      } catch (error) {
        console.error('[GatewayStream] Failed to parse snapshot event:', error)
      }
    })

    eventSource.addEventListener('delta', (event) => {
      try {
        const delta = JSON.parse(event.data) as GraphDelta
        // Convert date strings back to Date objects
        delta.addedNodes = delta.addedNodes.map((n) => ({
          ...n,
          startedAt: new Date(n.startedAt),
          endedAt: n.endedAt ? new Date(n.endedAt) : undefined,
          lastActivity: new Date(n.lastActivity),
        }))
        delta.updatedNodes = delta.updatedNodes.map((n) => ({
          ...n,
          startedAt: new Date(n.startedAt),
          endedAt: n.endedAt ? new Date(n.endedAt) : undefined,
          lastActivity: new Date(n.lastActivity),
        }))
        delta.addedEdges = delta.addedEdges.map((e) => ({
          ...e,
          createdAt: new Date(e.createdAt),
        }))
        onDelta?.(delta)
      } catch (error) {
        console.error('[GatewayStream] Failed to parse delta event:', error)
      }
    })

    eventSource.onerror = () => {
      eventSource.close()
      eventSourceRef.current = null
      updateConnectionState('error')

      // Auto-reconnect
      if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current += 1
        const delay = 3000 * Math.min(reconnectAttemptsRef.current, 5)
        reconnectTimeoutRef.current = setTimeout(() => {
          connect()
        }, delay)
      } else {
        updateConnectionState('disconnected')
      }
    }
  }, [
    agentId,
    sessionKeyPattern,
    channel,
    onSnapshot,
    onDelta,
    onMirrorStatus,
    autoReconnect,
    maxReconnectAttempts,
    updateConnectionState,
  ])

  const reconnect = useCallback(() => {
    disconnect()
    reconnectAttemptsRef.current = 0
    connect()
  }, [disconnect, connect])

  // Connect on mount
  useEffect(() => {
    connect()
    return () => {
      disconnect()
    }
  }, [connect, disconnect])

  return {
    connectionState,
    mirrorStatus,
    reconnect,
    disconnect,
  }
}
