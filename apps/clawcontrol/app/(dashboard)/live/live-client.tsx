'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { PageHeader, EmptyState, Button, SegmentedToggle, SelectDropdown } from '@clawcontrol/ui'
import { activitiesApi, agentsApi } from '@/lib/http'
import { useSseStream, type SseConnectionState } from '@/lib/hooks/useSseStream'
import type { ActivityDTO } from '@/lib/repo'
import { StationIcon } from '@/components/station-icon'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import { cn } from '@/lib/utils'
import {
  Activity as ActivityIcon,
  Play,
  Pause,
  RefreshCw,
  ClipboardList,
  Bot,
  Settings,
  Clock,
  Wifi,
  WifiOff,
  AlertCircle,
  LayoutGrid,
  List,
} from 'lucide-react'
import { VisualizerView } from './visualizer'

type ActivityType = 'all' | 'work_order' | 'operation' | 'agent' | 'system' | 'approval'
type ViewMode = 'timeline' | 'visualizer'
type RiskFilter = 'all' | 'safe' | 'caution' | 'danger'
type CategoryFilter = 'all' | 'shell' | 'file' | 'network' | 'browser' | 'message' | 'system' | 'memory' | 'governance' | 'security'

export function LiveClient() {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline')
  const [activities, setActivities] = useState<ActivityDTO[]>([])
  const [agentStationsByName, setAgentStationsByName] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<ActivityType>('all')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all')
  const [query, setQuery] = useState('')
  const [tailMode, setTailMode] = useState(true)
  const timelineRef = useRef<HTMLDivElement>(null)

  // Fetch initial activities
  useEffect(() => {
    async function fetchData() {
      try {
        const [activitiesResult, agentsResult] = await Promise.all([
          activitiesApi.list({ limit: 100 }),
          agentsApi.list(),
        ])
        setActivities(activitiesResult.data)
        setAgentStationsByName(
          Object.fromEntries(agentsResult.data.map((a) => [a.name, a.station]))
        )
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load activities')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // Handle new activity from SSE
  const handleNewActivity = useCallback((activity: ActivityDTO) => {
    setActivities((prev) => {
      // Avoid duplicates
      if (prev.some((a) => a.id === activity.id)) return prev
      // Add to front (newest first)
      return [activity, ...prev].slice(0, 200) // Keep max 200 items
    })
  }, [])

  // SSE connection
  const { connectionState, reconnect } = useSseStream({
    onActivity: handleNewActivity,
  })

  // Auto-scroll when in tail mode and new activities arrive
  useEffect(() => {
    if (tailMode && timelineRef.current) {
      timelineRef.current.scrollTop = 0
    }
  }, [activities, tailMode])

  const normalizedQuery = query.trim().toLowerCase()
  const filteredActivities = activities.filter((a) => {
    if (filter !== 'all' && !a.type.startsWith(filter)) return false
    if (categoryFilter !== 'all' && (a.category ?? '').toLowerCase() !== categoryFilter) return false
    if (riskFilter !== 'all' && (a.riskLevel ?? '').toLowerCase() !== riskFilter) return false
    if (normalizedQuery) {
      const haystack = `${a.summary} ${a.type} ${a.actor}`.toLowerCase()
      if (!haystack.includes(normalizedQuery)) return false
    }
    return true
  })

  const exportJson = useCallback(() => {
    const payload = JSON.stringify(filteredActivities, null, 2)
    downloadText(`clawcontrol-activities-${new Date().toISOString()}.json`, payload, 'application/json')
  }, [filteredActivities])

  const exportCsv = useCallback(() => {
    const header = ['id', 'ts', 'actor', 'type', 'category', 'riskLevel', 'summary']
    const rows = filteredActivities.map((a) => ([
      a.id,
      typeof a.ts === 'string' ? a.ts : new Date(a.ts).toISOString(),
      a.actor,
      a.type,
      a.category ?? '',
      a.riskLevel ?? '',
      a.summary,
    ]).map(csvCell).join(','))
    const payload = [header.join(','), ...rows].join('\n')
    downloadText(`clawcontrol-activities-${new Date().toISOString()}.csv`, payload, 'text/csv')
  }, [filteredActivities])

  if (loading) {
    return <LoadingState height="viewport" />
  }

  if (error) {
    return (
      <EmptyState
        icon={<ActivityIcon className="w-8 h-8" />}
        title="Error loading activities"
        description={error}
      />
    )
  }

  const typeIcons: Record<string, typeof ClipboardList> = {
    work_order: ClipboardList,
    operation: Settings,
    agent: Bot,
    system: RefreshCw,
    approval: Clock,
    cron: RefreshCw,
    gateway: ActivityIcon,
    receipt: ActivityIcon,
  }

  return (
    <div className="w-full space-y-4">
      <PageHeader
        title="Live Activity"
        subtitle="Real-time event stream"
        actions={
          <div className="flex items-center gap-3">
            {/* Mode Switch */}
            <SegmentedToggle
              value={viewMode}
              onChange={setViewMode}
              tone="neutral"
              ariaLabel="Live view mode"
              items={[
                {
                  value: 'timeline',
                  label: (
                    <>
                      <List className="w-3.5 h-3.5" />
                      Timeline
                    </>
                  ),
                },
                {
                  value: 'visualizer',
                  label: (
                    <>
                      <LayoutGrid className="w-3.5 h-3.5" />
                      Visualizer
                    </>
                  ),
                },
              ]}
            />

            {/* Timeline-specific controls */}
            {viewMode === 'timeline' && (
              <>
                {/* Filter */}
                <SelectDropdown
                  value={filter}
                  onChange={(nextValue) => setFilter(nextValue as ActivityType)}
                  ariaLabel="Live event filter"
                  tone="toolbar"
                  size="sm"
                  options={[
                    { value: 'all', label: 'All events' },
                    { value: 'work_order', label: 'Work Orders' },
                    { value: 'operation', label: 'Operations' },
                    { value: 'approval', label: 'Approvals' },
                    { value: 'agent', label: 'Agents' },
                    { value: 'system', label: 'System' },
                  ]}
                />

                {/* Category */}
                <SelectDropdown
                  value={categoryFilter}
                  onChange={(nextValue) => setCategoryFilter(nextValue as CategoryFilter)}
                  ariaLabel="Category filter"
                  tone="toolbar"
                  size="sm"
                  options={[
                    { value: 'all', label: 'All categories' },
                    { value: 'security', label: 'Security' },
                    { value: 'governance', label: 'Governance' },
                    { value: 'system', label: 'System' },
                    { value: 'shell', label: 'Shell' },
                    { value: 'file', label: 'File' },
                    { value: 'network', label: 'Network' },
                    { value: 'browser', label: 'Browser' },
                    { value: 'message', label: 'Message' },
                    { value: 'memory', label: 'Memory' },
                  ]}
                />

                {/* Risk */}
                <SelectDropdown
                  value={riskFilter}
                  onChange={(nextValue) => setRiskFilter(nextValue as RiskFilter)}
                  ariaLabel="Risk filter"
                  tone="toolbar"
                  size="sm"
                  options={[
                    { value: 'all', label: 'All risk' },
                    { value: 'safe', label: 'Safe' },
                    { value: 'caution', label: 'Caution' },
                    { value: 'danger', label: 'Danger' },
                  ]}
                />

                {/* Search */}
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="h-8 w-44 rounded-[var(--radius-md)] border border-bd-0 bg-bg-2 px-2 text-xs text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-status-progress/40"
                />

                {/* Export */}
                <Button onClick={exportJson} variant="secondary" size="sm">
                  Export JSON
                </Button>
                <Button onClick={exportCsv} variant="secondary" size="sm">
                  Export CSV
                </Button>

                {/* Tail Mode Toggle */}
                <Button
                  onClick={() => setTailMode(!tailMode)}
                  variant="secondary"
                  size="sm"
                  className={cn(tailMode && 'text-status-progress border-status-progress/30 bg-status-progress/10 hover:bg-status-progress/20')}
                >
                  {tailMode ? (
                    <Pause className="w-3.5 h-3.5" />
                  ) : (
                    <Play className="w-3.5 h-3.5" />
                  )}
                  Tail
                </Button>
              </>
            )}
          </div>
        }
      />

      {/* View content based on mode */}
      {viewMode === 'timeline' ? (
        <>
          {/* Connection Status */}
          <ConnectionStatus state={connectionState} onReconnect={reconnect} />

          {/* Activity Timeline */}
          <div
            ref={timelineRef}
            className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden max-h-[calc(100vh-280px)] overflow-y-auto"
          >
            {filteredActivities.length > 0 ? (
              <div className="divide-y divide-white/[0.06]">
                {filteredActivities.map((activity) => (
                  <ActivityRow
                    key={activity.id}
                    activity={activity}
                    typeIcons={typeIcons}
                    agentStationsByName={agentStationsByName}
                  />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={<ActivityIcon className="w-8 h-8" />}
                title="No activity"
                description="Events will appear here as they happen"
              />
            )}
          </div>
        </>
      ) : (
        <div className="h-[calc(100vh-200px)]">
          <VisualizerView />
        </div>
      )}
    </div>
  )
}

function ConnectionStatus({
  state,
  onReconnect,
}: {
  state: SseConnectionState
  onReconnect: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] border',
        state === 'connected' && 'bg-status-success/5 border-bd-1',
        state === 'connecting' && 'bg-status-warning/5 border-bd-1',
        state === 'disconnected' && 'bg-bg-2 border-bd-0',
        state === 'error' && 'bg-status-error/5 border-bd-1'
      )}
    >
      {state === 'connected' && (
        <>
          <Wifi className="w-3.5 h-3.5 text-status-success" />
          <span className="text-xs text-status-success">Connected — streaming live updates</span>
        </>
      )}
      {state === 'connecting' && (
        <>
          <LoadingSpinner size="sm" className="text-status-warning" />
          <span className="text-xs text-status-warning">Connecting...</span>
        </>
      )}
      {state === 'disconnected' && (
        <>
          <WifiOff className="w-3.5 h-3.5 text-fg-3" />
          <span className="text-xs text-fg-2">Disconnected</span>
          <button
            onClick={onReconnect}
            className="ml-2 text-xs text-status-progress hover:underline"
          >
            Reconnect
          </button>
        </>
      )}
      {state === 'error' && (
        <>
          <AlertCircle className="w-3.5 h-3.5 text-status-error" />
          <span className="text-xs text-status-error">Connection error</span>
          <button
            onClick={onReconnect}
            className="ml-2 text-xs text-status-progress hover:underline"
          >
            Retry
          </button>
        </>
      )}
    </div>
  )
}

function ActivityRow({
  activity,
  typeIcons,
  agentStationsByName,
}: {
  activity: ActivityDTO
  typeIcons: Record<string, typeof ClipboardList>
  agentStationsByName: Record<string, string>
}) {
  const [expanded, setExpanded] = useState(false)
  const typeKey = activity.type.split('.')[0]
  const Icon = typeIcons[typeKey] || ActivityIcon
  const isAgentActor = activity.actor.startsWith('agent:')
  const actorLabel = isAgentActor ? activity.actor.replace('agent:', '') : activity.actor
  const stationId = isAgentActor ? agentStationsByName[actorLabel] : undefined

  return (
    <div
      className={cn(
        'flex items-start gap-3 p-4 hover:bg-bg-3/30 transition-colors cursor-pointer',
        expanded && 'bg-bg-3/20'
      )}
      onClick={() => setExpanded(!expanded)}
    >
      {/* Icon */}
      <div
        className={cn(
          'p-1.5 rounded-[var(--radius-sm)] shrink-0',
          typeKey === 'work_order' && 'bg-status-progress/10 text-status-progress',
          typeKey === 'operation' && 'bg-status-info/10 text-status-info',
          typeKey === 'agent' && 'bg-status-success/10 text-status-success',
          typeKey === 'approval' && 'bg-status-warning/10 text-status-warning',
          typeKey === 'system' && 'bg-fg-3/10 text-fg-2',
          typeKey === 'cron' && 'bg-fg-3/10 text-fg-2',
          typeKey === 'gateway' && 'bg-status-success/10 text-status-success',
          typeKey === 'receipt' && 'bg-status-info/10 text-status-info'
        )}
      >
        <Icon className="w-3.5 h-3.5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-fg-0">{activity.summary}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-fg-2 font-mono">{activity.type}</span>
          <span className="text-fg-3">•</span>
          <span className="text-xs text-fg-2 font-mono">{(activity.category ?? 'system')}</span>
          <RiskPill riskLevel={activity.riskLevel ?? 'safe'} />
          {activity.actor !== 'system' && (
            <>
              <span className="text-fg-3">•</span>
              <span className="text-xs text-status-progress font-mono inline-flex items-center gap-1.5">
                {isAgentActor && <StationIcon stationId={stationId} />}
                {actorLabel}
              </span>
            </>
          )}
        </div>

        {/* Expanded details */}
        {expanded && Object.keys(activity.payloadJson).length > 0 && (
          <div className="mt-3 p-2 bg-bg-3/50 rounded-[var(--radius-sm)] text-xs font-mono text-fg-2 overflow-x-auto">
            <pre>{JSON.stringify(activity.payloadJson, null, 2)}</pre>
          </div>
        )}
      </div>

      {/* Timestamp */}
      <span className="text-xs text-fg-2 shrink-0 tabular-nums">
        {formatRelativeTime(activity.ts)}
      </span>
    </div>
  )
}

function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = now.getTime() - d.getTime()
  const secs = Math.floor(diff / 1000)
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs}s ago`
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

function csvCell(value: string): string {
  const normalized = value.replace(/\r?\n/g, ' ').trim()
  if (!normalized) return '""'
  const escaped = normalized.replace(/"/g, '""')
  return `"${escaped}"`
}

function downloadText(fileName: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function RiskPill({ riskLevel }: { riskLevel: 'safe' | 'caution' | 'danger' }) {
  const cfg = riskLevel === 'danger'
    ? 'bg-status-danger/10 text-status-danger border-status-danger/40'
    : riskLevel === 'caution'
      ? 'bg-status-warning/10 text-status-warning border-status-warning/40'
      : 'bg-status-success/10 text-status-success border-status-success/40'

  return (
    <span
      className={cn(
        'ml-1 inline-flex items-center rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px] font-mono',
        cfg
      )}
    >
      {riskLevel}
    </span>
  )
}
