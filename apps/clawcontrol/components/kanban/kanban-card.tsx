'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/utils'
import { PriorityPill } from '@/components/ui/status-pill'
import { isWorkOrderStale, getStaleDurationHours } from '@/lib/kanban-helpers'
import type { AgentDTO, WorkOrderWithOpsDTO } from '@/lib/repo'
import type { WorkOrderState } from '@clawcontrol/core'
import { Clock } from 'lucide-react'

interface KanbanCardProps {
  workOrder: WorkOrderWithOpsDTO
  agents: AgentDTO[]
  onClick: () => void
  onAssignToAgent: (id: string, agentName: string) => Promise<void>
  assigningWorkOrderId?: string | null
}

function formatOwnerLabel(owner: string): string {
  if (owner === 'clawcontrolceo') return 'clawcontrol CEO'
  if (owner === 'user') return 'User'
  return owner
}

function getOwnerTextClass(owner: string): string {
  if (owner === 'clawcontrolceo') return 'text-status-progress'
  if (owner === 'user') return 'text-fg-1'
  return 'text-status-info'
}

function stopEvent(event: React.SyntheticEvent) {
  event.stopPropagation()
}

export function KanbanCard({
  workOrder,
  agents,
  onClick,
  onAssignToAgent,
  assigningWorkOrderId,
}: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: workOrder.id,
    data: {
      type: 'work-order',
      workOrder,
      column: workOrder.state as WorkOrderState,
    },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  // Calculate operations progress
  const doneOps = workOrder.operations.filter((op) => op.status === 'done').length
  const totalOps = workOrder.operations.length
  const progressPercent = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0

  // Check if work order is stale
  const isStale = isWorkOrderStale(workOrder)
  const staleHours = isStale ? getStaleDurationHours(workOrder) : 0
  const staleDays = Math.floor(staleHours / 24)
  const isAssigning = assigningWorkOrderId === workOrder.id

  const availableAgents = useMemo(
    () => agents.filter((agent) => agent.status !== 'error'),
    [agents]
  )
  const [selectedAgent, setSelectedAgent] = useState('')

  useEffect(() => {
    if (workOrder.state !== 'planned') return
    if (selectedAgent) return
    if (availableAgents.length > 0) {
      setSelectedAgent(availableAgents[0].name)
    }
  }, [availableAgents, selectedAgent, workOrder.state])

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Prevent click during/after drag
        if (!isDragging) {
          e.stopPropagation()
          onClick()
        }
      }}
      className={cn(
        'p-3 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)]',
        'cursor-grab active:cursor-grabbing',
        'transition-all duration-150',
        'hover:border-bd-1 hover:bg-bg-3/50',
        'select-none touch-none',
        isDragging && 'opacity-50 shadow-lg ring-2 ring-status-info/50 z-50',
        // Subtle stale indicator border
        isStale && 'border-l-2 border-l-status-warning/60'
      )}
      data-dragging={isDragging}
    >
      {/* Header: Code + Priority */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs font-medium text-fg-1">
          {workOrder.code}
        </span>
        <PriorityPill priority={workOrder.priority} />
      </div>

      {/* Title */}
      <p className="text-sm text-fg-0 line-clamp-2 mb-2 leading-snug">
        {workOrder.title}
      </p>

      {/* Tags */}
      {workOrder.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {workOrder.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-[10px] rounded-full bg-bg-3 text-fg-1 border border-bd-0"
            >
              {tag}
            </span>
          ))}
          {workOrder.tags.length > 4 && (
            <span className="text-[10px] text-fg-2">+{workOrder.tags.length - 4}</span>
          )}
        </div>
      )}

      {/* Progress Bar (only if has operations) */}
      {totalOps > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-fg-2">{doneOps}/{totalOps} ops</span>
            <span className="text-[11px] text-fg-2">{progressPercent}%</span>
          </div>
          <div className="h-1 bg-bg-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-status-success transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer metadata */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-[11px] truncate', getOwnerTextClass(workOrder.owner))}>
            {formatOwnerLabel(workOrder.owner)}
          </span>
          <span className="text-[11px] text-fg-2 flex-shrink-0">
            {formatRelativeTime(workOrder.updatedAt)}
          </span>
        </div>
        {isStale && (
          <div className="flex items-center gap-1 text-[10px] font-medium text-status-warning">
            <Clock className="w-2.5 h-2.5" />
            <span title={`No updates in ${staleDays > 0 ? `${staleDays}d` : `${staleHours}h`}`}>
              Stale {staleDays > 0 ? `${staleDays}d` : `${staleHours}h`}
            </span>
          </div>
        )}
      </div>

      {/* Planned queue assignment */}
      {workOrder.state === 'planned' && (
        <div
          className="mt-2 pt-2 border-t border-bd-0/60 space-y-1.5"
          onClick={stopEvent}
          onPointerDown={stopEvent}
        >
          <span className="text-[10px] uppercase tracking-wide text-fg-3">
            Assign to Agent
          </span>
          <div className="flex items-center gap-1.5">
            <select
              value={selectedAgent}
              onChange={(event) => setSelectedAgent(event.target.value)}
              onClick={stopEvent}
              onPointerDown={stopEvent}
              className="flex-1 min-w-0 px-2 py-1 text-[11px] bg-bg-3 border border-bd-0 rounded-[var(--radius-sm)] text-fg-1 focus:outline-none focus:ring-1 focus:ring-status-info/40"
            >
              {availableAgents.length === 0 && (
                <option value="">No available agents</option>
              )}
              {availableAgents.map((agent) => (
                <option key={agent.id} value={agent.name}>
                  {agent.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={async (event) => {
                stopEvent(event)
                if (!selectedAgent || isAssigning) return
                await onAssignToAgent(workOrder.id, selectedAgent)
              }}
              onPointerDown={stopEvent}
              disabled={!selectedAgent || isAssigning || availableAgents.length === 0}
              className="px-2 py-1 text-[11px] font-medium rounded-[var(--radius-sm)] bg-status-info text-bg-0 hover:bg-status-info/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isAssigning ? 'Assigning...' : 'Assign'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Card variant for drag overlay (ghost card shown while dragging)
 */
export function KanbanCardOverlay({ workOrder }: { workOrder: WorkOrderWithOpsDTO }) {
  const doneOps = workOrder.operations.filter((op) => op.status === 'done').length
  const totalOps = workOrder.operations.length
  const progressPercent = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0

  return (
    <div
      className={cn(
        'p-3 bg-bg-2 border border-bd-0 rounded-[var(--radius-md)]',
        'shadow-2xl ring-2 ring-status-info/50',
        'cursor-grabbing',
        'rotate-2 scale-105',
        'w-[200px]' // Reasonable overlay width
      )}
    >
      {/* Header: Code + Priority */}
      <div className="flex items-center justify-between mb-2">
        <span className="font-mono text-xs font-medium text-fg-1">
          {workOrder.code}
        </span>
        <PriorityPill priority={workOrder.priority} />
      </div>

      {/* Title */}
      <p className="text-sm text-fg-0 line-clamp-2 mb-2 leading-snug">
        {workOrder.title}
      </p>

      {workOrder.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {workOrder.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-[10px] rounded-full bg-bg-3 text-fg-1 border border-bd-0"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Progress Bar */}
      {totalOps > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-fg-2">{doneOps}/{totalOps} ops</span>
            <span className="text-[11px] text-fg-2">{progressPercent}%</span>
          </div>
          <div className="h-1 bg-bg-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-status-success"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-fg-2">
          {formatRelativeTime(workOrder.updatedAt)}
        </span>
        <span className={cn('text-[10px] font-medium', getOwnerTextClass(workOrder.owner))}>
          {formatOwnerLabel(workOrder.owner)}
        </span>
      </div>
    </div>
  )
}
