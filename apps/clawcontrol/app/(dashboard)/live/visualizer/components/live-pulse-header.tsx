'use client'

import { cn } from '@/lib/utils'
import {
  Wifi,
  WifiOff,
  Loader2,
  AlertCircle,
  RefreshCw,
  Activity,
  AlertTriangle,
  PlayCircle,
  Clock,
  XOctagon,
  Moon,
} from 'lucide-react'
import type { SseConnectionState } from '@/lib/hooks/useSseStream'
import type { AttentionStats } from '../visualizer-store'

interface LivePulseHeaderProps {
  connectionState: SseConnectionState
  eventsPerSecond: number
  lastEventTime: Date | null
  onReconnect: () => void
  paused: boolean
  reconnectAttempt?: number
  reconnectingIn?: number | null
  attentionStats?: AttentionStats
  quietStatus?: { isQuiet: boolean; lastEventAgo: number | null }
  summaryStats?: { running: number; pending: number; blocked: number }
}

function formatRelativeTime(date: Date | null): string {
  if (!date) return 'never'

  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const secs = Math.floor(diff / 1000)

  if (secs < 2) return 'just now'
  if (secs < 60) return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

function formatDurationMs(ms: number | null): string {
  if (!ms) return 'never'
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  return `${Math.floor(secs / 3600)}h`
}

export function LivePulseHeader({
  connectionState,
  eventsPerSecond,
  lastEventTime,
  onReconnect,
  paused,
  reconnectAttempt = 0,
  reconnectingIn,
  attentionStats,
  quietStatus,
  summaryStats,
}: LivePulseHeaderProps) {
  const showQuietMode = quietStatus?.isQuiet && connectionState === 'connected'

  return (
    <div className="space-y-2">
      {/* Main status bar */}
      <div
        className={cn(
          'flex items-center justify-between gap-4 px-3 py-2 rounded-[var(--radius-md)] border',
          connectionState === 'connected' && 'bg-status-success/5 border-bd-1',
          connectionState === 'connecting' && 'bg-status-warning/5 border-bd-1',
          connectionState === 'disconnected' && 'bg-bg-2 border-bd-0',
          connectionState === 'error' && 'bg-status-danger/5 border-bd-1'
        )}
      >
        {/* Left: Connection status */}
        <div className="flex items-center gap-2">
          {connectionState === 'connected' && (
            <>
              <Wifi className="w-3.5 h-3.5 text-status-success" />
              <span className="text-xs text-status-success font-medium">Connected</span>
            </>
          )}
          {connectionState === 'connecting' && (
            <>
              <Loader2 className="w-3.5 h-3.5 text-status-warning animate-spin" />
              <span className="text-xs text-status-warning font-medium">Connecting</span>
            </>
          )}
          {connectionState === 'disconnected' && (
            <>
              <WifiOff className="w-3.5 h-3.5 text-fg-3" />
              <span className="text-xs text-fg-2">Disconnected</span>
            </>
          )}
          {connectionState === 'error' && (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-status-danger" />
              <span className="text-xs text-status-danger font-medium">Error</span>
            </>
          )}

          {/* Reconnect countdown */}
          {reconnectingIn != null && reconnectingIn > 0 && (
            <span className="text-xs text-fg-3 ml-2">
              Reconnecting in {reconnectingIn}s (attempt {reconnectAttempt})
            </span>
          )}

          {/* Paused indicator */}
          {paused && (
            <span className="ml-2 px-1.5 py-0.5 text-xs font-medium bg-status-warning/10 text-status-warning rounded-[var(--radius-sm)]">
              Paused
            </span>
          )}
        </div>

        {/* Center: Metrics (hidden on mobile) */}
        <div className="hidden sm:flex items-center gap-4">
          {/* Events per second */}
          <div className="flex items-center gap-1.5">
            <Activity className="w-3 h-3 text-fg-3" />
            <span className="text-xs text-fg-1 font-mono tabular-nums">
              {eventsPerSecond.toFixed(1)}
            </span>
            <span className="text-xs text-fg-3">/sec</span>
          </div>

          {/* Separator */}
          <span className="text-fg-3">|</span>

          {/* Last event */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-fg-2">Last:</span>
            <span className="text-xs text-fg-1 font-mono tabular-nums">
              {formatRelativeTime(lastEventTime)}
            </span>
          </div>
        </div>

        {/* Right: Reconnect button */}
        {(connectionState === 'disconnected' || connectionState === 'error') && (
          <button
            onClick={onReconnect}
            className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-status-progress hover:bg-status-progress/10 rounded-[var(--radius-sm)] transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            <span className="hidden sm:inline">Reconnect</span>
          </button>
        )}
      </div>

      {/* Attention strip (if there are issues) */}
      {attentionStats && attentionStats.total > 0 && (
        <div className="flex items-center gap-3 px-3 py-1.5 rounded-[var(--radius-md)] bg-status-danger/5 border border-status-danger/20">
          <AlertTriangle className="w-3.5 h-3.5 text-status-danger shrink-0" />
          <span className="text-xs font-medium text-status-danger">Needs attention:</span>
          <div className="flex items-center gap-3 text-xs">
            {attentionStats.failedReceipts > 0 && (
              <span className="text-status-danger">
                {attentionStats.failedReceipts} failed receipt{attentionStats.failedReceipts !== 1 ? 's' : ''}
              </span>
            )}
            {attentionStats.blockedWorkOrders > 0 && (
              <span className="text-status-danger">
                {attentionStats.blockedWorkOrders} blocked WO{attentionStats.blockedWorkOrders !== 1 ? 's' : ''}
              </span>
            )}
            {attentionStats.blockedOperations > 0 && (
              <span className="text-status-danger">
                {attentionStats.blockedOperations} blocked op{attentionStats.blockedOperations !== 1 ? 's' : ''}
              </span>
            )}
            {attentionStats.stuckOperations > 0 && (
              <span className="text-status-warning">
                {attentionStats.stuckOperations} stuck op{attentionStats.stuckOperations !== 1 ? 's' : ''} ({'>'}5m)
              </span>
            )}
          </div>
        </div>
      )}

      {/* Quiet mode summary (when no events for a while) */}
      {showQuietMode && summaryStats && (
        <div className="flex items-center gap-4 px-3 py-2 rounded-[var(--radius-md)] bg-bg-2 border border-bd-0">
          <div className="flex items-center gap-1.5">
            <Moon className="w-3.5 h-3.5 text-fg-3" />
            <span className="text-xs text-fg-2">Quiet</span>
            <span className="text-xs text-fg-3">
              — last event {formatDurationMs(quietStatus?.lastEventAgo ?? null)} ago
            </span>
          </div>

          <span className="text-fg-3">|</span>

          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-status-progress">
              <PlayCircle className="w-3 h-3" />
              {summaryStats.running} running
            </span>
            <span className="flex items-center gap-1 text-fg-2">
              <Clock className="w-3 h-3" />
              {summaryStats.pending} pending
            </span>
            {summaryStats.blocked > 0 && (
              <span className="flex items-center gap-1 text-status-danger">
                <XOctagon className="w-3 h-3" />
                {summaryStats.blocked} blocked
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Compact version for tight spaces
export function LivePulseCompact({
  connectionState,
  eventsPerSecond,
}: Pick<LivePulseHeaderProps, 'connectionState' | 'eventsPerSecond'>) {
  return (
    <div className="flex items-center gap-2">
      {/* Status dot */}
      <div
        className={cn(
          'w-2 h-2 rounded-full',
          connectionState === 'connected' && 'bg-status-success',
          connectionState === 'connecting' && 'bg-status-warning animate-pulse',
          connectionState === 'disconnected' && 'bg-fg-3',
          connectionState === 'error' && 'bg-status-danger'
        )}
      />

      {/* Rate */}
      <span className="text-xs text-fg-2 font-mono tabular-nums">
        {eventsPerSecond.toFixed(1)}/s
      </span>
    </div>
  )
}
