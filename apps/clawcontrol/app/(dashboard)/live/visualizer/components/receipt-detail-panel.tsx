'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import {
  Terminal,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  Wifi,
  WifiOff,
  AlertCircle,
} from 'lucide-react'
import { useReceiptStream } from '@/lib/hooks/useReceiptStream'

interface ReceiptDetailPanelProps {
  receiptId: string
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  const secs = Math.floor(ms / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remSecs = secs % 60
  return `${mins}m ${remSecs}s`
}

function formatTime(date: Date | null | undefined): string {
  if (!date) return '—'
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function ReceiptDetailPanel({ receiptId }: ReceiptDetailPanelProps) {
  const {
    stdout,
    stderr,
    isFinalized,
    exitCode,
    durationMs,
    metadata,
    connectionState,
    reconnect,
  } = useReceiptStream({ receiptId })

  const outputRef = useRef<HTMLPreElement>(null)

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [stdout, stderr])

  const hasOutput = stdout.length > 0 || stderr.length > 0

  return (
    <div className="flex flex-col h-full -m-4">
      {/* Header with metadata */}
      <div className="px-4 py-3 border-b border-bd-0 space-y-2">
        {/* Command name */}
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-fg-2" />
          <span className="font-mono text-sm text-fg-0 font-medium">
            {metadata?.commandName || receiptId.slice(0, 8)}
          </span>
        </div>

        {/* Status row */}
        <div className="flex items-center gap-4 text-xs">
          {/* Running/Finished indicator */}
          {isFinalized ? (
            <div className="flex items-center gap-1.5">
              {exitCode === 0 ? (
                <CheckCircle className="w-3.5 h-3.5 text-status-success" />
              ) : (
                <XCircle className="w-3.5 h-3.5 text-status-danger" />
              )}
              <span
                className={cn(
                  'font-mono font-medium',
                  exitCode === 0 ? 'text-status-success' : 'text-status-danger'
                )}
              >
                exit {exitCode}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 text-status-progress animate-spin" />
              <span className="text-status-progress font-medium">Running</span>
            </div>
          )}

          {/* Duration */}
          <div className="flex items-center gap-1.5 text-fg-2">
            <Clock className="w-3 h-3" />
            <span className="font-mono">{formatDuration(durationMs)}</span>
          </div>

          {/* Started at */}
          {metadata?.startedAt && (
            <span className="text-fg-3">
              Started: {formatTime(metadata.startedAt)}
            </span>
          )}
        </div>

        {/* Connection status */}
        <div className="flex items-center gap-2">
          {connectionState === 'connected' && (
            <>
              <Wifi className="w-3 h-3 text-status-success" />
              <span className="text-xs text-status-success">Streaming</span>
            </>
          )}
          {connectionState === 'connecting' && (
            <>
              <Loader2 className="w-3 h-3 text-status-warning animate-spin" />
              <span className="text-xs text-status-warning">Connecting...</span>
            </>
          )}
          {connectionState === 'disconnected' && !isFinalized && (
            <>
              <WifiOff className="w-3 h-3 text-fg-3" />
              <span className="text-xs text-fg-2">Disconnected</span>
              <button
                onClick={reconnect}
                className="text-xs text-status-progress hover:underline"
              >
                Reconnect
              </button>
            </>
          )}
          {connectionState === 'error' && (
            <>
              <AlertCircle className="w-3 h-3 text-status-danger" />
              <span className="text-xs text-status-danger">Connection error</span>
              <button
                onClick={reconnect}
                className="text-xs text-status-progress hover:underline"
              >
                Retry
              </button>
            </>
          )}
        </div>
      </div>

      {/* Output area */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {hasOutput ? (
          <pre
            ref={outputRef}
            className="h-full overflow-auto p-4 bg-bg-0 font-mono text-xs text-fg-1 leading-relaxed whitespace-pre-wrap break-words"
          >
            {/* Interleave stdout and stderr for now - could be improved with timestamps */}
            {stdout}
            {stderr && (
              <span className="text-status-danger">{stderr}</span>
            )}

            {/* Blinking cursor when running */}
            {!isFinalized && (
              <span className="animate-pulse text-status-progress">▋</span>
            )}
          </pre>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-fg-3">
            {isFinalized ? (
              <>
                <Terminal className="w-8 h-8 mb-2 opacity-50" />
                <span className="text-sm">No output</span>
              </>
            ) : (
              <>
                <Loader2 className="w-8 h-8 mb-2 animate-spin text-status-progress/50" />
                <span className="text-sm">Waiting for output...</span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Footer with receipt ID */}
      <div className="px-4 py-2 border-t border-bd-0 bg-bg-1">
        <span className="text-xs text-fg-3 font-mono">Receipt: {receiptId}</span>
      </div>
    </div>
  )
}

// Simplified panel for work orders and operations
interface EntityDetailPanelProps {
  entityType: 'work_order' | 'operation'
  entityId: string
  displayId: string
  title: string
  status: string
  metadata?: Record<string, string | number | null>
}

export function EntityDetailPanel({
  entityType,
  displayId,
  title,
  status,
  metadata,
}: EntityDetailPanelProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="font-mono text-lg font-semibold text-fg-0">{displayId}</h3>
        <p className="text-sm text-fg-1 mt-1">{title}</p>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-fg-2">Status:</span>
        <span className="px-2 py-0.5 text-xs font-medium bg-bg-3 text-fg-1 rounded-[var(--radius-sm)]">
          {status}
        </span>
      </div>

      {/* Metadata */}
      {metadata && Object.keys(metadata).length > 0 && (
        <div className="space-y-2">
          <span className="text-xs text-fg-2 uppercase tracking-wider">Details</span>
          <div className="bg-bg-2 rounded-[var(--radius-md)] p-3 space-y-2">
            {Object.entries(metadata).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between text-xs">
                <span className="text-fg-2">{key}</span>
                <span className="text-fg-1 font-mono">{value ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Placeholder for future actions */}
      <div className="pt-4 border-t border-bd-0">
        <span className="text-xs text-fg-3">
          View full details in {entityType === 'work_order' ? 'Work Orders' : 'Operations'}
        </span>
      </div>
    </div>
  )
}
