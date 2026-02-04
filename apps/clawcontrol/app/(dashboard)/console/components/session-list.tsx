'use client'

import { useState, useMemo } from 'react'
import { Bot, Clock, AlertCircle, CheckCircle, Pause } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ConsoleSessionDTO } from '@/app/api/openclaw/console/sessions/route'
import type { AvailabilityStatus } from '@/lib/openclaw/availability'

// ============================================================================
// TYPES
// ============================================================================

interface SessionListProps {
  sessions: ConsoleSessionDTO[]
  selectedId: string | null
  onSelect: (sessionId: string) => void
  gatewayStatus: AvailabilityStatus
}

type FilterState = 'all' | 'active' | 'idle' | 'error'

// ============================================================================
// HELPERS
// ============================================================================

function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const then = new Date(date).getTime()
  const diffMs = now - then

  if (diffMs < 60000) return 'just now'
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`
  if (diffMs < 86400000) return `${Math.floor(diffMs / 3600000)}h ago`
  return `${Math.floor(diffMs / 86400000)}d ago`
}

function getStateIcon(state: string) {
  switch (state) {
    case 'active':
      return <CheckCircle className="w-3 h-3 text-status-success" />
    case 'idle':
      return <Pause className="w-3 h-3 text-fg-3" />
    case 'error':
      return <AlertCircle className="w-3 h-3 text-status-danger" />
    default:
      return <Clock className="w-3 h-3 text-fg-3" />
  }
}

// ============================================================================
// COMPONENT
// ============================================================================

export function SessionList({ sessions, selectedId, onSelect, gatewayStatus }: SessionListProps) {
  const [filter, setFilter] = useState<FilterState>('all')

  // Filter sessions
  const filteredSessions = useMemo(() => {
    if (filter === 'all') return sessions
    return sessions.filter(s => s.state === filter)
  }, [sessions, filter])

  // Count by state
  const counts = useMemo(() => ({
    all: sessions.length,
    active: sessions.filter(s => s.state === 'active').length,
    idle: sessions.filter(s => s.state === 'idle').length,
    error: sessions.filter(s => s.state === 'error').length,
  }), [sessions])

  return (
    <div className="w-60 border-r border-bd-0 flex flex-col bg-bg-1">
      {/* Header */}
      <div className="p-3 border-b border-bd-0">
        <h2 className="text-sm font-medium text-fg-1">Sessions</h2>
        <div className="text-xs text-fg-3 mt-0.5">
          {sessions.length} session{sessions.length !== 1 ? 's' : ''}
          {gatewayStatus !== 'ok' && (
            <span className="ml-1 text-status-warning">(cached)</span>
          )}
        </div>
      </div>

      {/* Filter chips */}
      <div className="p-2 border-b border-bd-0 flex flex-wrap gap-1">
        {(['all', 'active', 'idle', 'error'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              'px-2 py-0.5 text-xs rounded transition-colors',
              filter === f
                ? 'bg-bg-3 text-fg-0'
                : 'text-fg-2 hover:bg-bg-2'
            )}
          >
            {f} ({counts[f]})
          </button>
        ))}
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        {filteredSessions.length === 0 ? (
          <div className="p-4 text-center text-xs text-fg-3">
            No {filter !== 'all' ? filter : ''} sessions
          </div>
        ) : (
          <div className="divide-y divide-bd-0">
            {filteredSessions.map((session) => (
              <button
                key={session.sessionId}
                onClick={() => onSelect(session.sessionId)}
                className={cn(
                  'w-full p-3 text-left transition-colors',
                  selectedId === session.sessionId
                    ? 'bg-bg-3'
                    : 'hover:bg-bg-2'
                )}
              >
                {/* Agent name + state */}
                <div className="flex items-center gap-2">
                  <Bot className="w-4 h-4 text-status-progress flex-shrink-0" />
                  <span className="text-sm font-mono text-fg-0 truncate">
                    {session.agentId}
                  </span>
                  <div className="ml-auto flex-shrink-0">
                    {getStateIcon(session.state)}
                  </div>
                </div>

                {/* Session info */}
                <div className="mt-1.5 flex items-center gap-2 text-xs text-fg-3">
                  <span className="truncate">{session.kind}</span>
                  <span className="text-fg-3/50">·</span>
                  <span className="flex-shrink-0">
                    {formatRelativeTime(session.lastSeenAt)}
                  </span>
                </div>

                {/* Context usage */}
                {session.percentUsed !== null && (
                  <div className="mt-2">
                    <div className="h-1 bg-bg-3 rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full transition-all',
                          session.percentUsed > 80
                            ? 'bg-status-danger'
                            : session.percentUsed > 50
                              ? 'bg-status-warning'
                              : 'bg-status-success'
                        )}
                        style={{ width: `${session.percentUsed}%` }}
                      />
                    </div>
                    <div className="mt-0.5 text-[10px] text-fg-3">
                      {session.percentUsed}% context used
                    </div>
                  </div>
                )}

                {/* Error indicator */}
                {session.abortedLastRun && (
                  <div className="mt-1.5 text-xs text-status-danger flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    <span>Last run aborted</span>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
