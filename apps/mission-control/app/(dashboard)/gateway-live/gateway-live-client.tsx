'use client'

import { useCallback } from 'react'
import { PageHeader, EmptyState } from '@savorg/ui'
import { cn } from '@/lib/utils'
import {
  Wifi,
  WifiOff,
  Loader2,
  AlertCircle,
  Pause,
  Play,
  RefreshCw,
  Zap,
  Radio,
} from 'lucide-react'
import { useGatewayStream } from './use-gateway-stream'
import { useGatewayGraphStore } from './graph-store'
import { GraphHeader } from './components/graph-header'
import { GraphView } from './components/graph-view'
import { NodeDetailDrawer } from './components/node-detail-drawer'

export function GatewayLiveClient() {
  const store = useGatewayGraphStore()
  const { state, actions, stats, selectedNode } = store

  // Connect to gateway stream
  const { connectionState, mirrorStatus, reconnect } = useGatewayStream({
    onSnapshot: actions.handleSnapshot,
    onDelta: actions.handleDelta,
    onConnectionChange: actions.handleConnectionChange,
    onMirrorStatus: actions.handleMirrorStatus,
  })

  const handleNodeClick = useCallback(
    (nodeId: string) => {
      actions.selectNode(nodeId === state.selectedNodeId ? null : nodeId)
    },
    [actions, state.selectedNodeId]
  )

  const handleCloseDrawer = useCallback(() => {
    actions.selectNode(null)
  }, [actions])

  return (
    <div className="w-full h-full flex flex-col">
      <PageHeader
        title="Gateway Live"
        subtitle="Real-time agent activity graph"
        actions={
          <div className="flex items-center gap-3">
            {/* Connection Status */}
            <ConnectionBadge
              state={connectionState}
              mirrorMode={mirrorStatus?.mode}
              onReconnect={reconnect}
            />

            {/* Stats */}
            <div className="flex items-center gap-2 text-xs text-fg-2">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3" />
                {stats.eventsPerSecond}/s
              </span>
              <span className="text-fg-3">·</span>
              <span>{stats.totalNodes} nodes</span>
              <span className="text-fg-3">·</span>
              <span>{stats.totalEdges} edges</span>
            </div>

            {/* Pause Toggle */}
            <button
              onClick={actions.togglePause}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border transition-colors',
                state.paused
                  ? 'bg-status-warning/10 text-status-warning border-status-warning/30'
                  : 'bg-bg-3 text-fg-2 border-white/[0.06] hover:border-bd-1'
              )}
            >
              {state.paused ? (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  Pause
                </>
              )}
            </button>
          </div>
        }
      />

      {/* Graph Header with Filters */}
      <GraphHeader store={store} />

      {/* Main Graph View */}
      <div className="flex-1 min-h-0 relative">
        {connectionState === 'connecting' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-1">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-fg-2" />
              <span className="text-sm text-fg-2">Connecting to Gateway...</span>
            </div>
          </div>
        ) : connectionState === 'error' || connectionState === 'disconnected' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-1">
            <EmptyState
              icon={<WifiOff className="w-8 h-8" />}
              title={connectionState === 'error' ? 'Connection Error' : 'Disconnected'}
              description={
                connectionState === 'error'
                  ? 'Failed to connect to the Gateway. Click to retry.'
                  : 'Not connected to the Gateway.'
              }
              action={
                <button
                  onClick={reconnect}
                  className="btn-secondary flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Reconnect
                </button>
              }
            />
          </div>
        ) : state.nodes.size === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center bg-bg-1">
            <EmptyState
              icon={<Radio className="w-8 h-8" />}
              title="Waiting for Activity"
              description="Agent activity will appear here as it happens."
            />
          </div>
        ) : (
          <GraphView store={store} onNodeClick={handleNodeClick} />
        )}
      </div>

      {/* Node Detail Drawer */}
      {selectedNode && (
        <NodeDetailDrawer node={selectedNode} onClose={handleCloseDrawer} />
      )}
    </div>
  )
}

function ConnectionBadge({
  state,
  mirrorMode,
  onReconnect,
}: {
  state: string
  mirrorMode?: string
  onReconnect: () => void
}) {
  const modeLabel = mirrorMode === 'websocket' ? 'WS' : mirrorMode === 'polling' ? 'Poll' : ''

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-md)] border text-xs',
        state === 'connected' && 'bg-status-success/5 border-status-success/20 text-status-success',
        state === 'connecting' && 'bg-status-warning/5 border-status-warning/20 text-status-warning',
        state === 'disconnected' && 'bg-bg-2 border-white/[0.06] text-fg-2',
        state === 'error' && 'bg-status-danger/5 border-status-danger/20 text-status-danger'
      )}
    >
      {state === 'connected' && (
        <>
          <Wifi className="w-3.5 h-3.5" />
          <span>Connected{modeLabel ? ` (${modeLabel})` : ''}</span>
        </>
      )}
      {state === 'connecting' && (
        <>
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>Connecting...</span>
        </>
      )}
      {state === 'disconnected' && (
        <>
          <WifiOff className="w-3.5 h-3.5" />
          <span>Disconnected</span>
          <button onClick={onReconnect} className="text-status-progress hover:underline ml-1">
            Reconnect
          </button>
        </>
      )}
      {state === 'error' && (
        <>
          <AlertCircle className="w-3.5 h-3.5" />
          <span>Error</span>
          <button onClick={onReconnect} className="text-status-progress hover:underline ml-1">
            Retry
          </button>
        </>
      )}
    </div>
  )
}
