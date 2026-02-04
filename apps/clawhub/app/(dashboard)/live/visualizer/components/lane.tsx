'use client'

import { cn } from '@/lib/utils'
import { ClipboardList, Settings, Terminal, ChevronDown, ChevronUp } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import type { VisualizerNode, VisualizerEntityType } from '../visualizer-store'
import { EntityNode } from './entity-node'

interface LaneProps {
  title: string
  entityType: VisualizerEntityType
  nodes: VisualizerNode[]
  selectedId?: string
  highlightedId?: string
  onNodeClick: (node: VisualizerNode) => void
  onPinNode?: (id: string) => void
  onUnpinNode?: (id: string) => void
  onJumpToReceipt?: (receiptId: string) => void
  onJumpToOperation?: (operationId: string) => void
  onJumpToWorkOrder?: (workOrderId: string) => void
  maxVisible?: number
  collapsible?: boolean
  defaultCollapsed?: boolean
}

const laneIcons: Record<VisualizerEntityType, typeof ClipboardList> = {
  work_order: ClipboardList,
  operation: Settings,
  receipt: Terminal,
}

export function Lane({
  title,
  entityType,
  nodes,
  selectedId,
  highlightedId,
  onNodeClick,
  onPinNode,
  onUnpinNode,
  onJumpToReceipt,
  onJumpToOperation,
  onJumpToWorkOrder,
  maxVisible = 20,
  collapsible = false,
  defaultCollapsed = false,
}: LaneProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const Icon = laneIcons[entityType]
  const scrollRef = useRef<HTMLDivElement>(null)

  // Sort nodes: pinned first, then by last activity (newest first)
  const sortedNodes = [...nodes].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1
    if (!a.isPinned && b.isPinned) return 1
    return b.lastActivity.getTime() - a.lastActivity.getTime()
  })

  const visibleNodes = sortedNodes.slice(0, maxVisible)
  const hiddenCount = Math.max(0, sortedNodes.length - maxVisible)

  // Auto-scroll to highlighted node
  useEffect(() => {
    if (highlightedId && scrollRef.current) {
      const highlightedElement = scrollRef.current.querySelector(
        `[data-node-id="${highlightedId}"]`
      )
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [highlightedId])

  return (
    <div className="flex flex-col min-w-0 h-full">
      {/* Header */}
      <div
        className={cn(
          'flex items-center justify-between gap-2 px-3 py-2 border-b border-bd-0 shrink-0',
          collapsible && 'cursor-pointer hover:bg-bg-3/30'
        )}
        onClick={collapsible ? () => setCollapsed(!collapsed) : undefined}
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-fg-2" />
          <span className="text-xs font-semibold text-fg-1 uppercase tracking-wider">{title}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Count badge */}
          <span
            className={cn(
              'px-1.5 py-0.5 text-xs font-mono rounded-[var(--radius-sm)]',
              nodes.length > 0 ? 'bg-status-progress/10 text-status-progress' : 'bg-bg-3 text-fg-3'
            )}
          >
            {nodes.length}
          </span>

          {/* Collapse toggle */}
          {collapsible && (
            <button className="p-0.5 text-fg-3 hover:text-fg-1">
              {collapsed ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronUp className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {!collapsed && (
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-2 min-h-0"
        >
          {visibleNodes.length > 0 ? (
            <>
              {visibleNodes.map((node) => (
                <div key={node.id} data-node-id={node.id}>
                  <EntityNode
                    node={node}
                    onClick={() => onNodeClick(node)}
                    isSelected={selectedId === node.id}
                    isHighlighted={highlightedId === node.id}
                    onPin={onPinNode ? () => onPinNode(node.id) : undefined}
                    onUnpin={onUnpinNode ? () => onUnpinNode(node.id) : undefined}
                    onJumpToReceipt={onJumpToReceipt}
                    onJumpToOperation={onJumpToOperation}
                    onJumpToWorkOrder={onJumpToWorkOrder}
                  />
                </div>
              ))}

              {/* Hidden count indicator */}
              {hiddenCount > 0 && (
                <div className="text-center py-2">
                  <span className="text-xs text-fg-3">+{hiddenCount} more</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center py-8 text-fg-3">
              <span className="text-xs">No active {entityType.replace('_', ' ')}s</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Horizontal scrollable lane for mobile
export function HorizontalLane({
  title,
  entityType,
  nodes,
  selectedId,
  onNodeClick,
}: Omit<LaneProps, 'onPinNode' | 'onUnpinNode' | 'maxVisible' | 'collapsible' | 'defaultCollapsed' | 'highlightedId' | 'onJumpToReceipt' | 'onJumpToOperation' | 'onJumpToWorkOrder'>) {
  const Icon = laneIcons[entityType]

  // Sort by last activity (newest first)
  const sortedNodes = [...nodes].sort(
    (a, b) => b.lastActivity.getTime() - a.lastActivity.getTime()
  )

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-bd-0">
        <Icon className="w-4 h-4 text-fg-2" />
        <span className="text-xs font-semibold text-fg-1 uppercase tracking-wider">{title}</span>
        <span className="px-1.5 py-0.5 text-xs font-mono bg-bg-3 text-fg-2 rounded-[var(--radius-sm)]">
          {nodes.length}
        </span>
      </div>

      {/* Horizontal scroll */}
      <div className="flex gap-2 p-2 overflow-x-auto scrollbar-hide">
        {sortedNodes.length > 0 ? (
          sortedNodes.slice(0, 10).map((node) => (
            <button
              key={node.id}
              onClick={() => onNodeClick(node)}
              className={cn(
                'flex-shrink-0 px-3 py-2 rounded-[var(--radius-md)] border transition-colors',
                selectedId === node.id
                  ? 'bg-bg-3 border-status-info/50'
                  : 'bg-bg-2 border-bd-0 hover:border-bd-1',
                node.isFading && 'opacity-50'
              )}
            >
              <span className="font-mono text-xs text-fg-0">{node.displayId}</span>
            </button>
          ))
        ) : (
          <span className="text-xs text-fg-3 px-2">No items</span>
        )}
      </div>
    </div>
  )
}
