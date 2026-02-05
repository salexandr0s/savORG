'use client'

import { useMemo, useState, useCallback } from 'react'
import { ChevronDown, Hammer, RefreshCw } from 'lucide-react'
import { cn, formatRelativeTime, formatDuration } from '@/lib/utils'
import type { GraphNode, GraphDelta, GraphSnapshot } from '@/lib/openclaw/live-graph'
import { useGatewayStream } from '@/app/(dashboard)/gateway-live/use-gateway-stream'

export function SessionActivity({ sessionKey }: { sessionKey: string }) {
  const [toolsById, setToolsById] = useState<Record<string, GraphNode>>({})
  const [open, setOpen] = useState(false)

  const sessionKeyPattern = useMemo(() => {
    const escaped = escapeRegExp(sessionKey)
    return `^${escaped}$`
  }, [sessionKey])

  const onSnapshot = useCallback((snapshot: GraphSnapshot) => {
    const next: Record<string, GraphNode> = {}
    for (const node of snapshot.nodes) {
      if (node.kind !== 'tool_call') continue
      next[node.id] = node
    }
    setToolsById(next)
  }, [])

  const onDelta = useCallback((delta: GraphDelta) => {
    setToolsById((prev) => {
      const next = { ...prev }

      for (const node of delta.addedNodes) {
        if (node.kind !== 'tool_call') continue
        next[node.id] = node
      }

      for (const node of delta.updatedNodes) {
        if (node.kind !== 'tool_call') continue
        next[node.id] = node
      }

      for (const id of delta.removedNodeIds) {
        if (id in next) delete next[id]
      }

      return next
    })
  }, [])

  const { connectionState, reconnect } = useGatewayStream({
    sessionKeyPattern,
    onSnapshot,
    onDelta,
    autoReconnect: true,
    maxReconnectAttempts: 10,
  })

  const tools = useMemo(() => {
    return Object.values(toolsById)
      .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime())
  }, [toolsById])

  const statusDot = useMemo(() => {
    switch (connectionState) {
      case 'connected':
        return 'bg-status-success'
      case 'connecting':
        return 'bg-status-warning'
      case 'error':
        return 'bg-status-danger'
      default:
        return 'bg-fg-3'
    }
  }, [connectionState])

  return (
    <div className="px-4 py-2 bg-bg-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={cn(
            'flex-1 flex items-center gap-2 text-left',
            'text-xs text-fg-2 hover:text-fg-0 transition-colors'
          )}
        >
          <ChevronDown
            className={cn('w-4 h-4 text-fg-3 transition-transform', open && 'rotate-180')}
          />
          <div className={cn('w-2 h-2 rounded-full', statusDot)} />
          <span className="font-medium">Tools</span>
          <span className="text-fg-3">({tools.length})</span>
        </button>

        <button
          type="button"
          onClick={reconnect}
          className="p-1 rounded-[var(--radius-sm)] hover:bg-bg-2 text-fg-2 hover:text-fg-0 transition-colors"
          title="Reconnect"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {open && (
        <div className="mt-2 space-y-2">
          {tools.length === 0 ? (
            <div className="text-[10px] text-fg-3 px-2 py-2">
              No tool activity captured for this session.
            </div>
          ) : (
            tools.map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function ToolRow({ tool }: { tool: GraphNode }) {
  const toolName = tool.metadata.toolName || 'tool'
  const isActive = tool.status === 'active'
  const isFailed = tool.status === 'failed'

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-3 py-2 rounded-[var(--radius-md)] border',
        'bg-bg-0 border-bd-0'
      )}
    >
      <div
        className={cn(
          'mt-0.5 w-7 h-7 rounded-[var(--radius-md)] flex items-center justify-center flex-shrink-0 border',
          isFailed
            ? 'border-status-danger/40 bg-status-danger/10'
            : isActive
              ? 'border-status-progress/40 bg-status-progress/10'
              : 'border-bd-0 bg-bg-2'
        )}
      >
        <Hammer className={cn('w-3.5 h-3.5', isFailed ? 'text-status-danger' : isActive ? 'text-status-progress' : 'text-fg-2')} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-fg-0 truncate">{toolName}</span>
          <span
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded-[var(--radius-sm)] border',
              isFailed
                ? 'border-status-danger/40 text-status-danger bg-status-danger/10'
                : isActive
                  ? 'border-status-progress/40 text-status-progress bg-status-progress/10'
                  : 'border-bd-0 text-fg-2 bg-bg-2'
            )}
          >
            {tool.status}
          </span>
        </div>

        <div className="mt-1 text-[10px] text-fg-3 flex flex-wrap gap-x-2 gap-y-1">
          <span>started {formatRelativeTime(tool.startedAt)}</span>
          <span className="text-fg-3/50">·</span>
          <span>last {formatRelativeTime(tool.lastActivity)}</span>
          {typeof tool.metadata.durationMs === 'number' && (
            <>
              <span className="text-fg-3/50">·</span>
              <span>{formatDuration(tool.metadata.durationMs)}</span>
            </>
          )}
          {typeof tool.metadata.exitCode === 'number' && (
            <>
              <span className="text-fg-3/50">·</span>
              <span className={tool.metadata.exitCode === 0 ? 'text-status-success' : 'text-status-danger'}>
                exit {tool.metadata.exitCode}
              </span>
            </>
          )}
        </div>

        {(tool.operationId || tool.workOrderId) && (
          <div className="mt-1 text-[10px] text-fg-3 font-mono">
            {tool.workOrderId ? `wo:${tool.workOrderId}` : null}
            {tool.workOrderId && tool.operationId ? ' ' : null}
            {tool.operationId ? `op:${tool.operationId}` : null}
          </div>
        )}
      </div>
    </div>
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
