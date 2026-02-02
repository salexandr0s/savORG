'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader, EmptyState } from '@savorgos/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { WorkOrderStatePill, PriorityPill } from '@/components/ui/status-pill'
import { ViewToggle, type ViewMode } from '@/components/ui/view-toggle'
import { KanbanBoard } from '@/components/kanban'
import { RightDrawer } from '@/components/shell/right-drawer'
import { workOrdersApi } from '@/lib/http'
import { useWorkOrderStream } from '@/lib/hooks/useWorkOrderStream'
import type { WorkOrderWithOpsDTO } from '@/lib/repo'
import type { WorkOrderState } from '@savorgos/core'
import { cn, formatRelativeTime } from '@/lib/utils'
import { ClipboardList, Plus, Filter, Loader2 } from 'lucide-react'

// ============================================================================
// CONSTANTS
// ============================================================================

const VIEW_STORAGE_KEY = 'savorg-work-orders-view'

// ============================================================================
// TABLE COLUMNS
// ============================================================================

const workOrderColumns: Column<WorkOrderWithOpsDTO>[] = [
  {
    key: 'code',
    header: 'Code',
    width: '80px',
    mono: true,
    render: (row) => (
      <span className="text-fg-1 hover:text-fg-0">{row.code}</span>
    ),
  },
  {
    key: 'title',
    header: 'Title',
    render: (row) => (
      <span className="truncate max-w-[320px] inline-block">{row.title}</span>
    ),
  },
  {
    key: 'state',
    header: 'State',
    width: '100px',
    render: (row) => <WorkOrderStatePill state={row.state} />,
  },
  {
    key: 'priority',
    header: 'Pri',
    width: '60px',
    align: 'center',
    render: (row) => <PriorityPill priority={row.priority} />,
  },
  {
    key: 'owner',
    header: 'Owner',
    width: '100px',
    render: (row) => (
      <span className={cn(
        'text-xs',
        row.owner === 'savorgceo' ? 'text-status-progress' : 'text-fg-1'
      )}>
        {row.owner === 'savorgceo' ? 'savorgCEO' : 'User'}
      </span>
    ),
  },
  {
    key: 'updatedAt',
    header: 'Updated',
    width: '100px',
    align: 'right',
    render: (row) => (
      <span className="text-fg-2 text-xs">{formatRelativeTime(row.updatedAt)}</span>
    ),
  },
]

// ============================================================================
// WORK ORDER DRAWER CONTENT
// ============================================================================

interface WorkOrderDrawerProps {
  workOrder: WorkOrderWithOpsDTO
}

function WorkOrderDrawerContent({ workOrder }: WorkOrderDrawerProps) {
  const doneOps = workOrder.operations.filter((op) => op.status === 'done').length
  const totalOps = workOrder.operations.length
  const progressPercent = totalOps > 0 ? Math.round((doneOps / totalOps) * 100) : 0

  return (
    <div className="space-y-4">
      {/* Header info */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm font-medium text-fg-0">{workOrder.code}</span>
        <WorkOrderStatePill state={workOrder.state} />
        <PriorityPill priority={workOrder.priority} />
      </div>

      {/* Title */}
      <h3 className="text-base font-medium text-fg-0">{workOrder.title}</h3>

      {/* Goal */}
      {workOrder.goalMd && (
        <div className="text-sm text-fg-1 whitespace-pre-wrap">
          {workOrder.goalMd}
        </div>
      )}

      {/* Progress */}
      {totalOps > 0 && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-fg-2">Operations Progress</span>
            <span className="text-xs text-fg-1">{doneOps}/{totalOps} ({progressPercent}%)</span>
          </div>
          <div className="h-1.5 bg-bg-3 rounded-full overflow-hidden">
            <div
              className="h-full bg-status-success transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Blocked reason */}
      {workOrder.blockedReason && (
        <div className="p-3 bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)]">
          <span className="text-xs font-medium text-status-danger">Blocked:</span>
          <p className="text-sm text-fg-1 mt-1">{workOrder.blockedReason}</p>
        </div>
      )}

      {/* Metadata */}
      <div className="pt-3 border-t border-white/[0.06] space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-fg-2">Owner</span>
          <span className="text-fg-1">{workOrder.owner === 'savorgceo' ? 'savorgCEO' : 'User'}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-fg-2">Routing</span>
          <span className="font-mono text-fg-1">{workOrder.routingTemplate}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-fg-2">Updated</span>
          <span className="text-fg-1">{formatRelativeTime(workOrder.updatedAt)}</span>
        </div>
        {workOrder.shippedAt && (
          <div className="flex justify-between text-xs">
            <span className="text-fg-2">Shipped</span>
            <span className="text-status-success">{formatRelativeTime(workOrder.shippedAt)}</span>
          </div>
        )}
      </div>

      {/* Action button */}
      <a
        href={`/work-orders/${workOrder.id}`}
        className="block w-full text-center px-4 py-2 text-xs font-medium bg-bg-3 text-fg-0 hover:bg-bg-3/80 rounded-[var(--radius-md)] border border-white/[0.06]"
      >
        View Full Details
      </a>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function WorkOrdersClient() {
  const router = useRouter()
  const [workOrders, setWorkOrders] = useState<WorkOrderWithOpsDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // View toggle state (persisted to localStorage)
  const [view, setView] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY)
      if (stored === 'table' || stored === 'board') return stored
    }
    return 'table'
  })

  // Drawer state for board view
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrderWithOpsDTO | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // Fetch work orders
  const fetchWorkOrders = useCallback(async () => {
    try {
      const result = await workOrdersApi.list()
      setWorkOrders(result.data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load work orders')
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch
  useEffect(() => {
    fetchWorkOrders()
  }, [fetchWorkOrders])

  // Persist view preference
  useEffect(() => {
    localStorage.setItem(VIEW_STORAGE_KEY, view)
  }, [view])

  // SSE-driven refresh (with fallback polling when disconnected)
  useWorkOrderStream({
    onRefresh: fetchWorkOrders,
    enabled: view === 'board',
    fallbackPollInterval: 120000, // 2 minutes fallback when SSE disconnected
  })

  // Handle state change from kanban drag-drop
  const handleStateChange = useCallback(
    async (id: string, newState: WorkOrderState, typedConfirmText?: string) => {
      // For dangerous transitions (ship/cancel), skip optimistic update
      // These go through TypedConfirmModal and should only update after server confirms
      const isDangerous = newState === 'shipped' || newState === 'cancelled'

      if (!isDangerous) {
        // Optimistic update for safe transitions
        setWorkOrders((prev) =>
          prev.map((wo) =>
            wo.id === id
              ? { ...wo, state: newState, updatedAt: new Date() }
              : wo
          )
        )
      }

      try {
        await workOrdersApi.update(id, {
          state: newState,
          typedConfirmText,
        })
        // Refresh to get server state
        await fetchWorkOrders()
      } catch (err) {
        console.error('Failed to update state:', err)
        // Refresh to restore correct state (rollback for safe, no-op for dangerous)
        await fetchWorkOrders()
      }
    },
    [fetchWorkOrders]
  )

  // Handle card click in board view
  const handleCardClick = useCallback((wo: WorkOrderWithOpsDTO) => {
    setSelectedWorkOrder(wo)
    setDrawerOpen(true)
  }, [])

  // Handle row click in table view
  const handleRowClick = useCallback(
    (row: WorkOrderWithOpsDTO) => {
      router.push(`/work-orders/${row.id}`)
    },
    [router]
  )

  // Close drawer
  const handleCloseDrawer = useCallback(() => {
    setDrawerOpen(false)
    setSelectedWorkOrder(null)
  }, [])

  // All work orders shown on board (all states now have columns)
  const boardWorkOrders = workOrders

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-fg-2" />
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <EmptyState
        icon={<ClipboardList className="w-8 h-8" />}
        title="Error loading work orders"
        description={error}
      />
    )
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Work Orders"
        subtitle={`${workOrders.length} total`}
        actions={
          <div className="flex items-center gap-2">
            <ViewToggle value={view} onChange={setView} />
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-bg-3 text-fg-1 hover:text-fg-0 border border-white/[0.06]">
              <Filter className="w-3.5 h-3.5" />
              Filter
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-info text-bg-0 hover:bg-status-info/90">
              <Plus className="w-3.5 h-3.5" />
              New Work Order
            </button>
          </div>
        }
      />

      {/* Table View */}
      {view === 'table' && (
        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-white/[0.06] overflow-hidden">
          <CanonicalTable
            columns={workOrderColumns}
            rows={workOrders}
            rowKey={(row) => row.id}
            onRowClick={handleRowClick}
            density="compact"
            emptyState={
              <EmptyState
                icon={<ClipboardList className="w-8 h-8" />}
                title="No work orders"
                description="Create your first work order to get started"
              />
            }
          />
        </div>
      )}

      {/* Board View */}
      {view === 'board' && (
        <KanbanBoard
          workOrders={boardWorkOrders}
          onWorkOrderClick={handleCardClick}
          onStateChange={handleStateChange}
        />
      )}

      {/* Detail Drawer (for board view) */}
      <RightDrawer
        open={drawerOpen}
        onClose={handleCloseDrawer}
        title={selectedWorkOrder?.code}
        description="Work Order Details"
      >
        {selectedWorkOrder && (
          <WorkOrderDrawerContent workOrder={selectedWorkOrder} />
        )}
      </RightDrawer>
    </div>
  )
}
