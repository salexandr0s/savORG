'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Bot, MessageSquare, Wrench, Settings, Radio } from 'lucide-react'
import type { useGatewayGraphStore } from '../graph-store'
import type { GraphNode, GraphEdge, GraphNodeKind, EdgeConfidence } from '@/lib/openclaw/live-graph'

/**
 * Simple lane-based graph visualization.
 * Groups nodes by session and renders them in a timeline layout.
 *
 * NOTE: This is a simple implementation without ReactFlow.
 * If true graph layout with edges is needed, we can add ReactFlow later.
 */

interface GraphViewProps {
  store: ReturnType<typeof useGatewayGraphStore>
  onNodeClick: (nodeId: string) => void
}

const NODE_KIND_CONFIG: Record<GraphNodeKind, { icon: typeof Bot; color: string; bgColor: string }> = {
  chat: { icon: MessageSquare, color: 'text-status-info', bgColor: 'bg-status-info/10' },
  session: { icon: Bot, color: 'text-status-success', bgColor: 'bg-status-success/10' },
  turn: { icon: Radio, color: 'text-fg-2', bgColor: 'bg-fg-3/10' },
  tool_call: { icon: Wrench, color: 'text-status-warning', bgColor: 'bg-status-warning/10' },
  assistant: { icon: Settings, color: 'text-status-progress', bgColor: 'bg-status-progress/10' },
}

export function GraphView({ store, onNodeClick }: GraphViewProps) {
  const { state, getFilteredNodes, getFilteredEdges } = store
  const filteredNodes = getFilteredNodes()
  const filteredEdges = getFilteredEdges()

  // Group nodes by session
  const sessionGroups = useMemo(() => {
    const groups = new Map<string, GraphNode[]>()

    for (const node of filteredNodes) {
      const sessionId = node.sessionId || 'unknown'
      if (!groups.has(sessionId)) {
        groups.set(sessionId, [])
      }
      groups.get(sessionId)!.push(node)
    }

    // Sort nodes within each group by startedAt
    for (const nodes of groups.values()) {
      nodes.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    }

    // Sort groups by most recent activity
    return Array.from(groups.entries())
      .map(([sessionId, nodes]) => ({
        sessionId,
        nodes,
        lastActivity: Math.max(...nodes.map((n) => n.lastActivity.getTime())),
        sessionNode: nodes.find((n) => n.kind === 'session'),
      }))
      .sort((a, b) => b.lastActivity - a.lastActivity)
  }, [filteredNodes])

  // Find spawn edges for displaying parent-child relationships
  const spawnEdges = useMemo(() => {
    return filteredEdges.filter((e) => e.kind === 'spawned')
  }, [filteredEdges])

  return (
    <div className="h-full overflow-auto p-4 bg-bg-1">
      <div className="space-y-4">
        {sessionGroups.map(({ sessionId, nodes, sessionNode }) => (
          <SessionGroup
            key={sessionId}
            sessionId={sessionId}
            nodes={nodes}
            sessionNode={sessionNode}
            selectedNodeId={state.selectedNodeId}
            highlightedNodeIds={state.highlightedNodeIds}
            spawnEdges={spawnEdges}
            onNodeClick={onNodeClick}
          />
        ))}
      </div>
    </div>
  )
}

interface SessionGroupProps {
  sessionId: string
  nodes: GraphNode[]
  sessionNode?: GraphNode
  selectedNodeId: string | null
  highlightedNodeIds: Set<string>
  spawnEdges: GraphEdge[]
  onNodeClick: (nodeId: string) => void
}

function SessionGroup({
  sessionId,
  nodes,
  sessionNode,
  selectedNodeId,
  highlightedNodeIds,
  spawnEdges,
  onNodeClick,
}: SessionGroupProps) {
  // Check if this session was spawned by another
  const parentEdge = spawnEdges.find((e) => e.targetId === `session:${sessionId}`)
  const childEdges = spawnEdges.filter((e) => e.sourceId === `session:${sessionId}`)

  return (
    <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
      {/* Session Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-bg-3/30 border-b border-bd-0">
        <div className="flex items-center gap-3">
          <Bot className="w-4 h-4 text-status-success" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-fg-0">
                {sessionNode?.agentId || 'Unknown Agent'}
              </span>
              {sessionNode?.metadata.isSubagent && (
                <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-status-info/10 text-status-info border border-status-info/20">
                  Subagent
                </span>
              )}
              {sessionNode?.status === 'active' && (
                <span className="w-2 h-2 rounded-full bg-status-success animate-pulse" />
              )}
            </div>
            <div className="text-xs text-fg-3 font-mono truncate max-w-[300px]">
              {sessionNode?.sessionKey || sessionId}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-fg-3">
          {sessionNode?.operationId && (
            <span className="font-mono">op:{sessionNode.operationId.slice(0, 8)}</span>
          )}
          {sessionNode?.workOrderId && (
            <span className="font-mono">wo:{sessionNode.workOrderId.slice(0, 8)}</span>
          )}
        </div>
      </div>

      {/* Parent/Child Indicators */}
      {parentEdge && (
        <div className="px-4 py-1.5 bg-status-info/5 border-b border-bd-0 text-xs text-status-info">
          <span className="opacity-70">Spawned from parent</span>
          <ConfidenceBadge confidence={parentEdge.confidence} />
        </div>
      )}
      {childEdges.length > 0 && (
        <div className="px-4 py-1.5 bg-status-progress/5 border-b border-bd-0 text-xs text-status-progress">
          <span className="opacity-70">Spawned {childEdges.length} subagent(s)</span>
        </div>
      )}

      {/* Timeline of events */}
      <div className="p-2">
        <div className="flex flex-wrap gap-2">
          {nodes
            .filter((n) => n.kind !== 'session') // Don't show session node in timeline
            .map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                isSelected={node.id === selectedNodeId}
                isHighlighted={highlightedNodeIds.has(node.id)}
                onClick={() => onNodeClick(node.id)}
              />
            ))}
        </div>
      </div>
    </div>
  )
}

interface NodeCardProps {
  node: GraphNode
  isSelected: boolean
  isHighlighted: boolean
  onClick: () => void
}

function NodeCard({ node, isSelected, isHighlighted, onClick }: NodeCardProps) {
  const config = NODE_KIND_CONFIG[node.kind]
  const Icon = config.icon

  const label = useMemo(() => {
    switch (node.kind) {
      case 'chat':
        return node.metadata.channel ? `${node.metadata.channel}` : 'CHAT'
      case 'tool_call':
        return node.metadata.toolName || 'tool'
      case 'turn':
        return 'turn'
      case 'assistant':
        return 'output'
      default:
        return node.kind
    }
  }, [node])

  const duration = node.metadata.durationMs
  const exitCode = node.metadata.exitCode

  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 px-2.5 py-1.5 rounded-[var(--radius-md)] border transition-all text-left',
        config.bgColor,
        isSelected
          ? 'border-fg-1 ring-1 ring-fg-1/30'
          : isHighlighted
            ? 'border-status-progress/50 ring-1 ring-status-progress/20'
            : 'border-bd-0 hover:border-bd-1',
        node.status === 'active' && 'animate-pulse',
        node.status === 'failed' && 'border-status-danger/30'
      )}
    >
      <Icon className={cn('w-3.5 h-3.5', config.color)} />
      <div className="flex flex-col">
        <span className="text-xs font-medium text-fg-0">{label}</span>
        <div className="flex items-center gap-1.5 text-[10px] text-fg-3">
          {duration !== undefined && <span>{duration}ms</span>}
          {exitCode !== undefined && exitCode !== 0 && (
            <span className="text-status-danger">exit {exitCode}</span>
          )}
          {node.status === 'active' && (
            <span className="text-status-progress">running</span>
          )}
        </div>
      </div>
    </button>
  )
}

function ConfidenceBadge({ confidence }: { confidence: EdgeConfidence }) {
  return (
    <span
      className={cn(
        'ml-2 px-1.5 py-0.5 text-[10px] font-medium rounded',
        confidence === 'high' && 'bg-status-success/10 text-status-success',
        confidence === 'medium' && 'bg-status-warning/10 text-status-warning',
        confidence === 'low' && 'bg-fg-3/10 text-fg-3'
      )}
    >
      {confidence}
    </span>
  )
}
