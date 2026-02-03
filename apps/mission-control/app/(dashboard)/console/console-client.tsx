'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { PageHeader, EmptyState } from '@savorg/ui'
import { Terminal, Wifi, WifiOff, AlertCircle, RefreshCw } from 'lucide-react'
import { useProtectedActionTrigger } from '@/components/protected-action-modal'
import { SessionList } from './components/session-list'
import { ChatPanel } from './components/chat-panel'
import { cn } from '@/lib/utils'
import type { ConsoleSessionDTO } from '@/app/api/openclaw/console/sessions/route'
import type { AvailabilityStatus } from '@/lib/openclaw/availability'

// ============================================================================
// TYPES
// ============================================================================

export interface ChatMessage {
  id: string
  role: 'operator' | 'agent' | 'system'
  content: string
  timestamp: Date
  pending?: boolean
  streaming?: boolean
  error?: string
}

interface SessionsApiResponse {
  status: AvailabilityStatus
  data: ConsoleSessionDTO[]
  gatewayAvailable: boolean
  cached: boolean
  timestamp: string
  error?: string
}

// ============================================================================
// CONSTANTS
// ============================================================================

const POLL_INTERVAL_MS = 5000
const RETRY_INTERVALS = [1000, 2000, 5000, 10000, 30000]

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ConsoleClient() {
  // State
  const [sessions, setSessions] = useState<ConsoleSessionDTO[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [gatewayStatus, setGatewayStatus] = useState<AvailabilityStatus>('ok')
  const [gatewayAvailable, setGatewayAvailable] = useState(true)

  // Refs for retry logic
  const retryCountRef = useRef(0)
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null)

  const triggerProtectedAction = useProtectedActionTrigger()

  // ============================================================================
  // DATA FETCHING
  // ============================================================================

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/openclaw/console/sessions')
      const data: SessionsApiResponse = await res.json()

      setSessions(data.data)
      setGatewayStatus(data.status)
      setGatewayAvailable(data.gatewayAvailable)
      setError(null)
      retryCountRef.current = 0 // Reset retry count on success
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions')
      setGatewayAvailable(false)
      setGatewayStatus('unavailable')

      // Exponential backoff
      const retryIndex = Math.min(retryCountRef.current, RETRY_INTERVALS.length - 1)
      retryCountRef.current++

      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }

      setTimeout(() => {
        fetchSessions()
      }, RETRY_INTERVALS[retryIndex])
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchHistory = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch(`/api/openclaw/console/sessions/${sessionId}/history`)
      const data = await res.json()

      if (data.ok && data.messages) {
        const historyMessages: ChatMessage[] = data.messages.map((m: {
          id: string
          ts: string
          role: 'operator' | 'agent' | 'system'
          summary: string
          payload?: { content?: string }
        }) => ({
          id: m.id,
          role: m.role,
          content: m.payload?.content || m.summary,
          timestamp: new Date(m.ts),
        }))
        setMessages(historyMessages)
      }
    } catch {
      // Silently fail - history is optional
    }
  }, [])

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Initial fetch and polling
  useEffect(() => {
    fetchSessions()

    pollIntervalRef.current = setInterval(fetchSessions, POLL_INTERVAL_MS)

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current)
      }
    }
  }, [fetchSessions])

  // Fetch history when session selected
  useEffect(() => {
    if (selectedSessionId) {
      setMessages([]) // Clear existing messages
      fetchHistory(selectedSessionId)
    }
  }, [selectedSessionId, fetchHistory])

  // ============================================================================
  // HANDLERS
  // ============================================================================

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId)
  }, [])

  const handleSendMessage = useCallback(async (content: string) => {
    if (!selectedSessionId || streaming) return

    triggerProtectedAction({
      actionKind: 'console.session.chat',
      actionTitle: 'Send to Session',
      actionDescription: `Send message to session (true session injection)`,
      onConfirm: async (typedConfirmText) => {
        // Add operator message optimistically
        const operatorMessageId = `msg_${Date.now()}_operator`
        setMessages(prev => [...prev, {
          id: operatorMessageId,
          role: 'operator',
          content,
          timestamp: new Date(),
          pending: true,
        }])

        setStreaming(true)

        try {
          // Use the new session chat endpoint (WS-based, true session injection)
          const res = await fetch(`/api/openclaw/console/sessions/${selectedSessionId}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: content, typedConfirmText }),
          })

          if (!res.ok) {
            const errorData = await res.json()
            throw new Error(errorData.error || 'Failed to send message')
          }

          // Add agent message placeholder
          const agentMessageId = `msg_${Date.now()}_agent`
          setMessages(prev => [...prev, {
            id: agentMessageId,
            role: 'agent',
            content: '',
            timestamp: new Date(),
            streaming: true,
          }])

          // Process SSE stream
          const reader = res.body?.getReader()
          if (!reader) throw new Error('No response stream')

          const decoder = new TextDecoder()
          let agentResponse = ''

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const text = decoder.decode(value, { stream: true })
            const lines = text.split('\n')

            for (const line of lines) {
              const trimmed = line.trim()
              if (!trimmed || !trimmed.startsWith('data: ')) continue

              const data = trimmed.slice(6)
              if (data === '[DONE]') continue

              try {
                const parsed = JSON.parse(data)
                if (parsed.chunk) {
                  agentResponse += parsed.chunk
                  // Update streaming message
                  setMessages(prev => {
                    const updated = [...prev]
                    const lastIdx = updated.length - 1
                    if (lastIdx >= 0 && updated[lastIdx].streaming) {
                      updated[lastIdx] = { ...updated[lastIdx], content: agentResponse }
                    }
                    return updated
                  })
                }
                if (parsed.error) {
                  throw new Error(parsed.error)
                }
              } catch (parseErr) {
                if (parseErr instanceof SyntaxError) continue
                throw parseErr
              }
            }
          }

          // Mark messages as complete
          setMessages(prev => prev.map(m => ({
            ...m,
            pending: false,
            streaming: false,
          })))
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : 'Send failed'
          // Mark operator message as error
          setMessages(prev => prev.map(m =>
            m.id === operatorMessageId
              ? { ...m, pending: false, error: errorMsg }
              : m
          ))
          setError(errorMsg)
        } finally {
          setStreaming(false)
        }
      },
      onError: (err) => {
        setError(err.message)
      },
    })
  }, [selectedSessionId, streaming, triggerProtectedAction])

  const handleRefresh = useCallback(() => {
    setLoading(true)
    fetchSessions()
  }, [fetchSessions])

  // ============================================================================
  // RENDER
  // ============================================================================

  const selectedSession = sessions.find(s => s.sessionId === selectedSessionId)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <PageHeader
        title="Console"
        actions={
          <div className="flex items-center gap-3">
            {/* Gateway status indicator */}
            <div className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded text-xs',
              gatewayStatus === 'ok' && 'bg-status-success/10 text-status-success',
              gatewayStatus === 'degraded' && 'bg-status-warning/10 text-status-warning',
              gatewayStatus === 'unavailable' && 'bg-status-danger/10 text-status-danger',
            )}>
              {gatewayAvailable ? (
                <Wifi className="w-3.5 h-3.5" />
              ) : (
                <WifiOff className="w-3.5 h-3.5" />
              )}
              <span className="font-medium">
                {gatewayStatus === 'ok' && 'Connected'}
                {gatewayStatus === 'degraded' && 'Degraded'}
                {gatewayStatus === 'unavailable' && 'Unavailable'}
              </span>
            </div>

            {/* Refresh button */}
            <button
              onClick={handleRefresh}
              disabled={loading}
              className={cn(
                'p-2 rounded hover:bg-bg-3/50 transition-colors',
                loading && 'opacity-50 cursor-not-allowed'
              )}
            >
              <RefreshCw className={cn('w-4 h-4 text-fg-2', loading && 'animate-spin')} />
            </button>
          </div>
        }
      />

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-4 p-3 bg-status-danger/10 border border-status-danger/20 rounded flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-status-danger flex-shrink-0" />
          <span className="text-sm text-status-danger">{error}</span>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-xs text-fg-3 hover:text-fg-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {loading && sessions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-3">
              <RefreshCw className="w-6 h-6 text-fg-3 animate-spin" />
              <span className="text-sm text-fg-2">Loading sessions...</span>
            </div>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <EmptyState
              icon={<Terminal className="w-12 h-12" />}
              title="No Sessions"
              description="No OpenClaw sessions found. Sessions will appear here once agents are active."
            />
          </div>
        ) : (
          <>
            {/* Session list (left sidebar) */}
            <SessionList
              sessions={sessions}
              selectedId={selectedSessionId}
              onSelect={handleSelectSession}
              gatewayStatus={gatewayStatus}
            />

            {/* Chat panel (main area) */}
            <ChatPanel
              session={selectedSession ?? null}
              messages={messages}
              onSend={handleSendMessage}
              streaming={streaming}
              sendDisabled={!gatewayAvailable}
            />
          </>
        )}
      </div>
    </div>
  )
}
