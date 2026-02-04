'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

interface UseWorkOrderStreamOptions {
  /** Called when work order data should be refreshed */
  onRefresh: () => void
  /** Whether streaming is enabled (e.g., only when board view is active) */
  enabled?: boolean
  /** Fallback polling interval in ms (used when SSE disconnects) */
  fallbackPollInterval?: number
}

interface StreamStatus {
  connected: boolean
  error: string | null
  lastEventAt: Date | null
}

/**
 * Hook for SSE-driven work order updates with fallback polling.
 *
 * Subscribes to /api/stream/activities?entityType=work_order for real-time updates.
 * Falls back to polling if SSE connection fails.
 */
export function useWorkOrderStream({
  onRefresh,
  enabled = true,
  fallbackPollInterval = 120000, // 2 minutes fallback
}: UseWorkOrderStreamOptions) {
  const eventSourceRef = useRef<EventSource | null>(null)
  const fallbackIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [status, setStatus] = useState<StreamStatus>({
    connected: false,
    error: null,
    lastEventAt: null,
  })

  // Debounce refresh to avoid rapid-fire updates
  const lastRefreshRef = useRef<number>(0)
  const DEBOUNCE_MS = 500

  const debouncedRefresh = useCallback(() => {
    const now = Date.now()
    if (now - lastRefreshRef.current > DEBOUNCE_MS) {
      lastRefreshRef.current = now
      onRefresh()
    }
  }, [onRefresh])

  // Start fallback polling
  const startFallbackPolling = useCallback(() => {
    if (fallbackIntervalRef.current) return
    fallbackIntervalRef.current = setInterval(onRefresh, fallbackPollInterval)
  }, [onRefresh, fallbackPollInterval])

  // Stop fallback polling
  const stopFallbackPolling = useCallback(() => {
    if (fallbackIntervalRef.current) {
      clearInterval(fallbackIntervalRef.current)
      fallbackIntervalRef.current = null
    }
  }, [])

  // Connect to SSE
  const connect = useCallback(() => {
    // Don't connect if disabled or already connected
    if (!enabled || eventSourceRef.current) return

    try {
      const url = '/api/stream/activities?entityType=work_order'
      const eventSource = new EventSource(url)
      eventSourceRef.current = eventSource

      eventSource.onopen = () => {
        setStatus((prev) => ({
          ...prev,
          connected: true,
          error: null,
        }))
        // SSE connected - stop fallback polling
        stopFallbackPolling()
      }

      eventSource.addEventListener('connected', () => {
        setStatus((prev) => ({
          ...prev,
          connected: true,
          error: null,
        }))
      })

      eventSource.addEventListener('activity', (event) => {
        try {
          const data = JSON.parse(event.data)
          const activity = data.data

          // Refresh on work order state changes
          if (
            activity?.type?.startsWith('work_order.') ||
            activity?.entityType === 'work_order'
          ) {
            setStatus((prev) => ({
              ...prev,
              lastEventAt: new Date(),
            }))
            debouncedRefresh()
          }
        } catch (err) {
          console.warn('[SSE] Failed to parse activity:', err)
        }
      })

      eventSource.onerror = (err) => {
        console.warn('[SSE] Connection error:', err)
        setStatus((prev) => ({
          ...prev,
          connected: false,
          error: 'Connection lost',
        }))

        // Close the errored connection
        eventSource.close()
        eventSourceRef.current = null

        // Start fallback polling
        startFallbackPolling()

        // Try to reconnect after 5 seconds
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          connect()
        }, 5000)
      }
    } catch (err) {
      console.error('[SSE] Failed to create EventSource:', err)
      setStatus((prev) => ({
        ...prev,
        connected: false,
        error: 'Failed to connect',
      }))
      startFallbackPolling()
    }
  }, [enabled, debouncedRefresh, startFallbackPolling, stopFallbackPolling])

  // Disconnect from SSE
  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }
    stopFallbackPolling()
    setStatus({
      connected: false,
      error: null,
      lastEventAt: null,
    })
  }, [stopFallbackPolling])

  // Connect/disconnect based on enabled state
  useEffect(() => {
    if (enabled) {
      connect()
    } else {
      disconnect()
    }

    return () => {
      disconnect()
    }
  }, [enabled, connect, disconnect])

  // Refresh on window focus (supplement to SSE)
  useEffect(() => {
    if (!enabled) return

    const handleFocus = () => {
      debouncedRefresh()
    }

    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
  }, [enabled, debouncedRefresh])

  return {
    status,
    /** Force a manual refresh */
    refresh: onRefresh,
  }
}
