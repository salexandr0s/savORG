'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { PageHeader, PageSection, EmptyState } from '@clawcontrol/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { StatusPill } from '@/components/ui/status-pill'
import { RightDrawer } from '@/components/shell/right-drawer'
import { AvailabilityBadge } from '@/components/availability-badge'
import { getModelShortName } from '@/lib/models'
import {
  addUtcDays,
  addUtcMonths,
  addUtcYears,
  estimateRunsForUtcDate,
  estimateRunsInUtcRange,
  listUtcDaysInRange,
  monthGridCells,
  rangeForCalendarView,
  startOfUtcDay,
  type CalendarView,
  type CronCalendarJob,
} from '@/lib/cron/calendar'
import type { CronJobDTO } from '@/lib/data'
import { cn } from '@/lib/utils'
import {
  Clock,
  Plus,
  Play,
  Pause,
  Loader2,
  Trash2,
  X,
  RefreshCw,
  Search,
  Save,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import type { StatusTone } from '@clawcontrol/ui/theme'

type AvailabilityStatus = 'ok' | 'degraded' | 'unavailable'

type OpenClawResponse<T> = {
  status: AvailabilityStatus
  latencyMs: number
  data: T | null
  error: string | null
  timestamp: string
  cached: boolean
  staleAgeMs?: number
}

/**
 * Actual CLI job structure (differs from the UI's CronJobDTO).
 * The OpenClaw CLI currently returns a nested `state` object.
 */
interface CliCronJob {
  id: string
  name: string
  schedule: {
    kind: 'at' | 'every' | 'cron'
    atMs?: number
    everyMs?: number
    expr?: string
    tz?: string
  }
  description?: string
  enabled?: boolean
  sessionTarget?: 'main' | 'isolated'
  wakeMode?: 'now' | 'next-heartbeat'
  agentId?: string
  payload?: {
    kind?: string
    message?: string
    text?: string
    channel?: string
    to?: string
  }
  state?: {
    lastRunAtMs?: number
    nextRunAtMs?: number
    lastStatus?: string
    lastDurationMs?: number
    runCount?: number
  }
  // Legacy flat fields (for backwards compat)
  lastRunAt?: string
  nextRunAt?: string
  lastStatus?: 'success' | 'failed' | 'running'
  runCount?: number
}

interface CronJobRow extends CronJobDTO {
  raw: CliCronJob
  frequencyText: string
  rawScheduleText: string
}

interface CronHealthJob {
  id: string
  name: string
  successRatePct: number
  failureCount: number
  lastFailureReason: string | null
  failureTrend: 'up' | 'flat' | 'down'
  flakinessScore: number
  isFlaky: boolean
}

interface CronHealthReport {
  summary: {
    jobsTotal: number
    jobsWithFailures: number
    flakyJobs: number
    avgSuccessRatePct: number
    totalFailures: number
  }
  jobs: CronHealthJob[]
}

type EditMode = 'every' | 'cron' | 'at'
type InsightsGroup = {
  key: string
  inputTokens: string
  outputTokens: string
  cacheReadTokens: string
  cacheWriteTokens: string
  totalTokens: string
  totalCostMicros: string
  sessionCount: number
}

type AgentModelRow = {
  id: string
  name: string
  displayName: string
  slug: string
  runtimeAgentId: string
  model: string | null
}

type CronCostEstimate = {
  modelId: string | null
  modelLabel: string
  confidence: 'high' | 'medium' | 'low' | 'none'
  estimatedRuns30d: number
  tokensPerRun: number | null
  costMicrosPerRun: number | null
  projectedTokens30d: number | null
  projectedCostMicros30d: number | null
}

type DayBucket = {
  day: Date
  dayKey: string
  totalRuns: number
  jobs: Array<{
    job: CronJobRow
    runs: number
  }>
}

function formatDurationShort(ms: number): string {
  if (ms % 86400000 === 0) return `${ms / 86400000}d`
  if (ms % 3600000 === 0) return `${ms / 3600000}h`
  if (ms % 60000 === 0) return `${ms / 60000}m`
  if (ms % 1000 === 0) return `${ms / 1000}s`
  return `${ms}ms`
}

function formatDurationLong(ms: number): string {
  if (ms % 86400000 === 0) {
    const days = ms / 86400000
    return `Every ${days} day${days === 1 ? '' : 's'}`
  }
  if (ms % 3600000 === 0) {
    const hours = ms / 3600000
    return `Every ${hours} hour${hours === 1 ? '' : 's'}`
  }
  if (ms % 60000 === 0) {
    const minutes = ms / 60000
    return `Every ${minutes} minute${minutes === 1 ? '' : 's'}`
  }
  if (ms % 1000 === 0) {
    const seconds = ms / 1000
    return `Every ${seconds} second${seconds === 1 ? '' : 's'}`
  }
  return `Every ${ms}ms`
}

function scheduleToFrequencyText(schedule: CliCronJob['schedule']): string {
  if (schedule.kind === 'every' && typeof schedule.everyMs === 'number') {
    return formatDurationLong(schedule.everyMs)
  }
  if (schedule.kind === 'cron') {
    return `Cron expression (${schedule.expr ?? '* * * * *'})`
  }
  if (schedule.kind === 'at') {
    return schedule.atMs ? `One-time at ${new Date(schedule.atMs).toLocaleString()}` : 'One-time schedule'
  }
  return 'Unknown frequency'
}

function scheduleToRawText(schedule: CliCronJob['schedule']): string {
  if (schedule.kind === 'every' && typeof schedule.everyMs === 'number') {
    return `every ${formatDurationShort(schedule.everyMs)}`
  }
  if (schedule.kind === 'cron') {
    return schedule.expr ?? '* * * * *'
  }
  if (schedule.kind === 'at' && typeof schedule.atMs === 'number') {
    return new Date(schedule.atMs).toISOString()
  }
  return schedule.kind
}

function parseCronExpr(expr: string, tz?: string): string {
  const parts = expr.split(' ')
  if (parts.length !== 5) return expr

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  const tzSuffix = tz ? ` (${tz.split('/').pop()})` : ''

  // Every N minutes: */N * * * *
  if (
    minute.startsWith('*/') &&
    hour === '*' &&
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*'
  ) {
    const interval = parseInt(minute.slice(2), 10)
    return `Every ${interval} min`
  }

  // Specific minutes each hour: M,M * * * * or M * * * *
  if (hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    if (minute.includes(',')) {
      const mins = minute.split(',')
      return `${mins.length}× per hour${tzSuffix}`
    }
    if (minute !== '*') {
      return `Hourly at :${minute.padStart(2, '0')}${tzSuffix}`
    }
  }

  // Daily at specific time: M H * * *
  if (
    dayOfMonth === '*' &&
    month === '*' &&
    dayOfWeek === '*' &&
    hour !== '*' &&
    minute !== '*'
  ) {
    const h = parseInt(hour, 10)
    const m = parseInt(minute, 10)
    const period = h >= 12 ? 'PM' : 'AM'
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
    return `Daily ${h12}:${String(m).padStart(2, '0')} ${period}${tzSuffix}`
  }

  // Weekly: M H * * D
  if (dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const day = days[parseInt(dayOfWeek, 10)] ?? dayOfWeek
    return `Weekly on ${day}${tzSuffix}`
  }

  return expr
}

function formatSchedule(schedule: CliCronJob['schedule']): string {
  switch (schedule.kind) {
    case 'cron':
      return parseCronExpr(schedule.expr ?? '* * * * *', schedule.tz)
    case 'every': {
      if (!schedule.everyMs) return 'Interval unknown'
      const ms = schedule.everyMs
      if (ms < 60000) return `Every ${ms / 1000}s`
      if (ms < 3600000) return `Every ${ms / 60000} min`
      if (ms < 86400000) return `Every ${ms / 3600000}h`
      return `Every ${ms / 86400000}d`
    }
    case 'at':
      return schedule.atMs ? new Date(schedule.atMs).toLocaleString() : 'One-time (TBD)'
    default:
      return 'Unknown'
  }
}

function mapToUiDto(job: CliCronJob): CronJobRow {
  const state = job.state
  const lastRunAtMs = state?.lastRunAtMs
  const nextRunAtMs = state?.nextRunAtMs
  const lastStatus = state?.lastStatus ?? job.lastStatus
  const runCount = state?.runCount ?? job.runCount ?? 0

  const mappedStatus =
    lastStatus === 'ok' ? 'success' : (lastStatus as CronJobDTO['lastStatus'])

  return {
    id: job.id,
    name: job.name,
    schedule: formatSchedule(job.schedule),
    description: job.description ?? '',
    enabled: job.enabled ?? true,
    lastRunAt: lastRunAtMs
      ? new Date(lastRunAtMs)
      : job.lastRunAt
        ? new Date(job.lastRunAt)
        : null,
    nextRunAt: nextRunAtMs
      ? new Date(nextRunAtMs)
      : job.nextRunAt
        ? new Date(job.nextRunAt)
        : null,
    lastStatus: mappedStatus ?? null,
    runCount,
    createdAt: new Date(),
    updatedAt: new Date(),
    raw: job,
    frequencyText: scheduleToFrequencyText(job.schedule),
    rawScheduleText: scheduleToRawText(job.schedule),
  }
}

function toCalendarJob(job: CronJobRow): CronCalendarJob {
  return {
    id: job.id,
    enabled: job.enabled,
    schedule: job.raw.schedule,
    nextRunAtMs: job.raw.state?.nextRunAtMs ?? job.nextRunAt?.getTime() ?? null,
    lastRunAtMs: job.raw.state?.lastRunAtMs ?? job.lastRunAt?.getTime() ?? null,
  }
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function formatTokenCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value === 0) return '0'
  return Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value)
}

function formatUsdMicros(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0.00'
  return Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value / 1_000_000 >= 1 ? 2 : 4,
    maximumFractionDigits: 4,
  }).format(value / 1_000_000)
}

function parseBigIntSafe(value: string): bigint {
  try {
    return BigInt(value)
  } catch {
    return 0n
  }
}

function bigIntToApproxNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER)
  if (value > max) return Number.MAX_SAFE_INTEGER
  if (value < -max) return Number.MIN_SAFE_INTEGER
  return Number(value)
}

function modelShortLabel(modelId: string | null): string {
  if (!modelId) return 'Unknown'
  return getModelShortName(modelId)
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  )
}

function formatLocalTime(value: Date | null | undefined): string {
  if (!value) return '—'
  return value.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function buildAgentTokenMap(agents: AgentModelRow[]): Map<string, AgentModelRow> {
  const map = new Map<string, AgentModelRow>()

  for (const agent of agents) {
    const values = [
      agent.id,
      agent.runtimeAgentId,
      agent.slug,
      agent.displayName,
      agent.name,
    ]
      .map((v) => v?.trim().toLowerCase())
      .filter((v): v is string => Boolean(v))

    for (const value of values) {
      map.set(value, agent)
    }
  }

  return map
}

const cronColumns: Column<CronJobRow>[] = [
  {
    key: 'status',
    header: '',
    width: '24px',
    render: (row) => (
      <span className={cn(
        'w-2 h-2 rounded-full inline-block',
        row.enabled ? 'bg-status-success' : 'bg-fg-3'
      )} />
    ),
  },
  {
    key: 'name',
    header: 'Job',
    width: '200px',
    render: (row) => <span className="text-fg-0 font-medium">{row.name}</span>,
  },
  {
    key: 'schedule',
    header: 'Schedule',
    width: '140px',
    render: (row) => <span className="text-fg-1">{row.schedule}</span>,
  },
  {
    key: 'lastStatus',
    header: 'Status',
    width: '80px',
    render: (row) => {
      if (!row.lastStatus) return <span className="text-fg-3">—</span>
      const toneMap: Record<string, StatusTone> = {
        success: 'success',
        failed: 'danger',
        running: 'progress',
      }
      return <StatusPill tone={toneMap[row.lastStatus] ?? 'muted'} label={row.lastStatus} />
    },
  },
  {
    key: 'nextRunAt',
    header: 'Next',
    width: '80px',
    align: 'right',
    render: (row) => (
      <span className="text-fg-2 text-sm">
        {row.nextRunAt ? formatRelativeTime(row.nextRunAt) : '—'}
      </span>
    ),
  },
]

const cronHealthColumns: Column<CronHealthJob>[] = [
  {
    key: 'name',
    header: 'Job',
    render: (row) => <span className="text-fg-0">{row.name}</span>,
  },
  {
    key: 'successRatePct',
    header: 'Success',
    width: '90px',
    align: 'right',
    render: (row) => <span className="font-mono text-fg-1">{row.successRatePct.toFixed(1)}%</span>,
  },
  {
    key: 'failureCount',
    header: 'Fails',
    width: '70px',
    align: 'right',
    render: (row) => (
      <span className={cn('font-mono', row.failureCount > 0 ? 'text-status-danger' : 'text-fg-2')}>
        {row.failureCount}
      </span>
    ),
  },
  {
    key: 'flakinessScore',
    header: 'Flaky',
    width: '80px',
    align: 'right',
    render: (row) => (
      <span className={cn('font-mono', row.isFlaky ? 'text-status-warning' : 'text-fg-2')}>
        {(row.flakinessScore * 100).toFixed(0)}%
      </span>
    ),
  },
  {
    key: 'lastFailureReason',
    header: 'Last failure reason',
    render: (row) => <span className="text-xs text-fg-2">{row.lastFailureReason || '—'}</span>,
  },
]

export function CronClient() {
  const [availability, setAvailability] = useState<OpenClawResponse<unknown> | null>(null)
  const [cronJobs, setCronJobs] = useState<CronJobRow[]>([])
  const [healthReport, setHealthReport] = useState<CronHealthReport | null>(null)
  const [healthSort, setHealthSort] = useState<'failures' | 'success' | 'flaky'>('failures')
  const [calendarView, setCalendarView] = useState<CalendarView>('month')
  const [calendarAnchor, setCalendarAnchor] = useState<Date>(() => startOfUtcDay(new Date()))
  const [selectedCalendarDay, setSelectedCalendarDay] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [agentModels, setAgentModels] = useState<AgentModelRow[]>([])
  const [usageByAgent, setUsageByAgent] = useState<InsightsGroup[]>([])
  const [usageByModel, setUsageByModel] = useState<InsightsGroup[]>([])
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const selectedJob = selectedId ? cronJobs.find((c) => c.id === selectedId) : undefined
  const userTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local',
    []
  )

  const enabledCount = cronJobs.filter((c) => c.enabled).length
  const filteredCronJobs = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    if (!q) return cronJobs

    return cronJobs.filter((job) => {
      const haystack = [
        job.name,
        job.description,
        job.schedule,
        job.frequencyText,
        job.rawScheduleText,
        job.raw.agentId ?? '',
        job.raw.sessionTarget ?? '',
        job.raw.wakeMode ?? '',
        job.raw.payload?.kind ?? '',
        job.raw.payload?.message ?? '',
        job.raw.payload?.text ?? '',
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(q)
    })
  }, [cronJobs, searchText])

  const sortedHealthJobs = useMemo(() => {
    const rows = [...(healthReport?.jobs ?? [])]
    if (healthSort === 'success') {
      rows.sort((a, b) => b.successRatePct - a.successRatePct)
      return rows
    }
    if (healthSort === 'flaky') {
      rows.sort((a, b) => b.flakinessScore - a.flakinessScore)
      return rows
    }
    rows.sort((a, b) => b.failureCount - a.failureCount)
    return rows
  }, [healthReport?.jobs, healthSort])

  const calendarJobs = useMemo(
    () => filteredCronJobs.map((job) => ({ row: job, schedule: toCalendarJob(job) })),
    [filteredCronJobs]
  )

  const calendarRange = useMemo(
    () => rangeForCalendarView(calendarAnchor, calendarView),
    [calendarAnchor, calendarView]
  )

  const dayBuckets = useMemo<DayBucket[]>(() => {
    const days = listUtcDaysInRange(calendarRange.start, calendarRange.end)

    return days.map((day) => {
      const jobs = calendarJobs
        .map(({ row, schedule }) => ({
          job: row,
          runs: estimateRunsForUtcDate(schedule, day),
        }))
        .filter((item) => item.runs > 0)
        .sort((a, b) => b.runs - a.runs || a.job.name.localeCompare(b.job.name))

      return {
        day,
        dayKey: utcDayKey(day),
        totalRuns: jobs.reduce((sum, item) => sum + item.runs, 0),
        jobs,
      }
    })
  }, [calendarJobs, calendarRange.end, calendarRange.start])

  const dayBucketsByKey = useMemo(() => {
    const out = new Map<string, DayBucket>()
    for (const bucket of dayBuckets) out.set(bucket.dayKey, bucket)
    return out
  }, [dayBuckets])

  const yearBuckets = useMemo(() => {
    if (calendarView !== 'year') return []

    const year = calendarAnchor.getUTCFullYear()
    return Array.from({ length: 12 }, (_, monthIndex) => {
      const start = new Date(Date.UTC(year, monthIndex, 1))
      const end = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999))

      const jobs = calendarJobs
        .map(({ row, schedule }) => ({
          job: row,
          runs: estimateRunsInUtcRange(schedule, start, end),
        }))
        .filter((item) => item.runs > 0)
        .sort((a, b) => b.runs - a.runs || a.job.name.localeCompare(b.job.name))

      return {
        monthIndex,
        monthLabel: start.toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' }),
        start,
        totalRuns: jobs.reduce((sum, item) => sum + item.runs, 0),
        jobs,
      }
    })
  }, [calendarAnchor, calendarJobs, calendarView])

  const agentByToken = useMemo(() => buildAgentTokenMap(agentModels), [agentModels])

  const usageByAgentMap = useMemo(() => {
    const out = new Map<string, InsightsGroup>()
    for (const row of usageByAgent) out.set(row.key.trim().toLowerCase(), row)
    return out
  }, [usageByAgent])

  const usageByModelMap = useMemo(() => {
    const out = new Map<string, InsightsGroup>()
    for (const row of usageByModel) out.set(row.key.trim().toLowerCase(), row)
    return out
  }, [usageByModel])

  const runs30dByJob = useMemo(() => {
    const start = startOfUtcDay(new Date())
    const end = addUtcDays(start, 29)
    const out = new Map<string, number>()
    for (const { row, schedule } of calendarJobs) {
      out.set(row.id, estimateRunsInUtcRange(schedule, start, end))
    }
    return out
  }, [calendarJobs])

  const scheduledRuns30dByAgent = useMemo(() => {
    const out = new Map<string, number>()

    for (const job of filteredCronJobs) {
      if (!job.enabled) continue
      const candidateTokens = [job.raw.agentId, job.raw.payload?.to]
        .map((v) => v?.trim().toLowerCase())
        .filter((v): v is string => Boolean(v))

      const matchedAgent = candidateTokens
        .map((token) => agentByToken.get(token))
        .find((row): row is AgentModelRow => Boolean(row))

      const agentKey = matchedAgent?.runtimeAgentId?.trim().toLowerCase() ?? candidateTokens[0]
      if (!agentKey) continue

      const runs = runs30dByJob.get(job.id) ?? 0
      out.set(agentKey, (out.get(agentKey) ?? 0) + runs)
    }

    return out
  }, [agentByToken, filteredCronJobs, runs30dByJob])

  const costEstimateByJob = useMemo(() => {
    const out = new Map<string, CronCostEstimate>()

    for (const job of filteredCronJobs) {
      const candidateTokens = [job.raw.agentId, job.raw.payload?.to]
        .map((v) => v?.trim().toLowerCase())
        .filter((v): v is string => Boolean(v))

      const matchedAgent = candidateTokens
        .map((token) => agentByToken.get(token))
        .find((row): row is AgentModelRow => Boolean(row))

      const runtimeAgentId = matchedAgent?.runtimeAgentId?.trim().toLowerCase() ?? candidateTokens[0] ?? null
      const modelId = matchedAgent?.model ?? defaultModelId

      const agentUsage = runtimeAgentId ? usageByAgentMap.get(runtimeAgentId) : undefined
      const modelUsage = modelId ? usageByModelMap.get(modelId.trim().toLowerCase()) : undefined

      const scheduledRuns = runtimeAgentId ? (scheduledRuns30dByAgent.get(runtimeAgentId) ?? 0) : 0
      const estimatedRuns30d = runs30dByJob.get(job.id) ?? 0

      const agentTotalTokens = parseBigIntSafe(agentUsage?.totalTokens ?? '0')
      const agentTotalCostMicros = parseBigIntSafe(agentUsage?.totalCostMicros ?? '0')
      const modelTotalTokens = parseBigIntSafe(modelUsage?.totalTokens ?? '0')
      const modelTotalCostMicros = parseBigIntSafe(modelUsage?.totalCostMicros ?? '0')

      let confidence: CronCostEstimate['confidence'] = 'none'
      let tokensPerRun: number | null = null
      let costMicrosPerRun: number | null = null

      if (scheduledRuns > 0 && agentTotalTokens > 0n) {
        tokensPerRun = bigIntToApproxNumber(agentTotalTokens) / scheduledRuns
        confidence = 'medium'
      } else if ((modelUsage?.sessionCount ?? 0) > 0 && modelTotalTokens > 0n) {
        tokensPerRun = bigIntToApproxNumber(modelTotalTokens) / modelUsage!.sessionCount
        confidence = 'low'
      }

      if (tokensPerRun !== null && modelTotalTokens > 0n && modelTotalCostMicros > 0n) {
        const modelCostPerToken = bigIntToApproxNumber(modelTotalCostMicros) / bigIntToApproxNumber(modelTotalTokens)
        costMicrosPerRun = tokensPerRun * modelCostPerToken
        confidence = confidence === 'medium' ? 'high' : 'medium'
      } else if (scheduledRuns > 0 && agentTotalCostMicros > 0n) {
        costMicrosPerRun = bigIntToApproxNumber(agentTotalCostMicros) / scheduledRuns
        if (confidence === 'none') confidence = 'low'
      }

      const projectedTokens30d = tokensPerRun === null ? null : tokensPerRun * estimatedRuns30d
      const projectedCostMicros30d = costMicrosPerRun === null ? null : costMicrosPerRun * estimatedRuns30d

      out.set(job.id, {
        modelId,
        modelLabel: modelShortLabel(modelId),
        confidence,
        estimatedRuns30d,
        tokensPerRun,
        costMicrosPerRun,
        projectedTokens30d,
        projectedCostMicros30d,
      })
    }

    return out
  }, [
    agentByToken,
    defaultModelId,
    filteredCronJobs,
    runs30dByJob,
    scheduledRuns30dByAgent,
    usageByAgentMap,
    usageByModelMap,
  ])

  const projectedTotals30d = useMemo(() => {
    let tokens = 0
    let cost = 0

    for (const estimate of costEstimateByJob.values()) {
      tokens += estimate.projectedTokens30d ?? 0
      cost += estimate.projectedCostMicros30d ?? 0
    }

    return { tokens, cost }
  }, [costEstimateByJob])

  const refreshJobs = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const [
        response,
        healthResponse,
        agentsResponse,
        usageByAgentResponse,
        usageByModelResponse,
        modelsResponse,
      ] = await Promise.all([
        fetch('/api/openclaw/cron/jobs', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        }),
        fetch('/api/openclaw/cron/health?days=7', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        }),
        fetch('/api/agents', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        }),
        fetch('/api/openclaw/usage/breakdown?groupBy=agent', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        }),
        fetch('/api/openclaw/usage/breakdown?groupBy=model', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        }),
        fetch('/api/models', {
          method: 'GET',
          headers: { Accept: 'application/json' },
        }),
      ])

      const data = (await response.json()) as OpenClawResponse<unknown>
      setAvailability(data)

      if (healthResponse.ok) {
        const health = (await healthResponse.json()) as { data: CronHealthReport }
        setHealthReport(health.data)
      }

      if (data.status === 'unavailable') {
        setCronJobs([])
        setError(data.error ?? 'Unable to load cron jobs')
        return
      }

      const raw = data.data as unknown
      const jobsArray: CliCronJob[] = Array.isArray(raw)
        ? (raw as CliCronJob[])
        : (raw as { jobs?: CliCronJob[] } | null)?.jobs ?? []

      setCronJobs(jobsArray.map(mapToUiDto))

      if (agentsResponse.ok) {
        const agentsPayload = (await agentsResponse.json()) as { data?: AgentModelRow[] }
        if (Array.isArray(agentsPayload.data)) {
          setAgentModels(agentsPayload.data)
        }
      } else {
        setAgentModels([])
      }

      if (usageByAgentResponse.ok) {
        const usagePayload = (await usageByAgentResponse.json()) as {
          data?: { groups?: InsightsGroup[] }
        }
        setUsageByAgent(Array.isArray(usagePayload.data?.groups) ? usagePayload.data.groups : [])
      } else {
        setUsageByAgent([])
      }

      if (usageByModelResponse.ok) {
        const usagePayload = (await usageByModelResponse.json()) as {
          data?: { groups?: InsightsGroup[] }
        }
        setUsageByModel(Array.isArray(usagePayload.data?.groups) ? usagePayload.data.groups : [])
      } else {
        setUsageByModel([])
      }

      if (modelsResponse.ok) {
        const modelsPayload = (await modelsResponse.json()) as {
          data?: { status?: { resolvedDefault?: string; defaultModel?: string } }
        }
        setDefaultModelId(modelsPayload.data?.status?.resolvedDefault ?? modelsPayload.data?.status?.defaultModel ?? null)
      } else {
        setDefaultModelId(null)
      }
    } catch (err) {
      setAvailability(null)
      setCronJobs([])
      setError(err instanceof Error ? err.message : 'Unable to load cron jobs')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshJobs()
  }, [refreshJobs])

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (calendarView === 'year') {
      setSelectedCalendarDay(null)
      return
    }

    if (selectedCalendarDay && dayBucketsByKey.has(selectedCalendarDay)) return
    setSelectedCalendarDay(dayBuckets[0]?.dayKey ?? null)
  }, [calendarView, dayBuckets, dayBucketsByKey, selectedCalendarDay])

  const handleJobCreated = async () => {
    await refreshJobs()
    setCreateModalOpen(false)
  }

  const handleJobDeleted = async () => {
    await refreshJobs()
    setSelectedId(undefined)
  }

  const selectedDayBucket = selectedCalendarDay ? dayBucketsByKey.get(selectedCalendarDay) : null
  const nowLocalLabel = useMemo(
    () =>
      new Date(nowMs).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [nowMs]
  )

  const calendarLabel = useMemo(() => {
    if (calendarView === 'day') {
      return calendarAnchor.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      })
    }

    if (calendarView === 'week') {
      const end = addUtcDays(rangeForCalendarView(calendarAnchor, 'week').start, 6)
      return `${rangeForCalendarView(calendarAnchor, 'week').start.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC',
      })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}`
    }

    if (calendarView === 'month') {
      return calendarAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    }

    return calendarAnchor.toLocaleDateString(undefined, { year: 'numeric', timeZone: 'UTC' })
  }, [calendarAnchor, calendarView])

  const shiftCalendar = useCallback((delta: number) => {
    setCalendarAnchor((prev) => {
      if (calendarView === 'day') return addUtcDays(prev, delta)
      if (calendarView === 'week') return addUtcDays(prev, delta * 7)
      if (calendarView === 'month') return addUtcMonths(prev, delta)
      return addUtcYears(prev, delta)
    })
  }, [calendarView])

  return (
    <>
      <div className="w-full space-y-4">
        {availability && (
          <div>
            <AvailabilityBadge
              status={availability.status}
              latencyMs={availability.latencyMs}
              cached={availability.cached}
              staleAgeMs={availability.staleAgeMs}
              label="Cron"
              size="sm"
            />
          </div>
        )}

        <PageHeader
          title="Cron Jobs"
          subtitle={
            searchText.trim()
              ? `${filteredCronJobs.length} shown (${enabledCount} enabled / ${cronJobs.length} total)`
              : `${enabledCount} enabled / ${cronJobs.length} total`
          }
          actions={
            <>
              <button
                onClick={refreshJobs}
                disabled={isLoading}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] border transition-colors',
                  'bg-bg-3 text-fg-1 border-bd-0 hover:text-fg-0 hover:bg-bg-2',
                  'disabled:opacity-50 disabled:cursor-not-allowed'
                )}
              >
                <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
                Refresh
              </button>

              <button
                onClick={() => setCreateModalOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-[var(--radius-md)] bg-status-info text-bg-0 hover:bg-status-info/90"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Job
              </button>
            </>
          }
        />

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search cron jobs by name, schedule, agent, or payload..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-status-info/50"
          />
        </div>

        {healthReport && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <HealthCard label="Avg success" value={`${healthReport.summary.avgSuccessRatePct.toFixed(1)}%`} />
              <HealthCard label="Failures (7d)" value={String(healthReport.summary.totalFailures)} />
              <HealthCard label="Jobs w/ failures" value={String(healthReport.summary.jobsWithFailures)} />
              <HealthCard label="Flaky jobs" value={String(healthReport.summary.flakyJobs)} />
            </div>

            <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-bd-0 flex items-center justify-between">
                <h2 className="text-sm font-medium text-fg-0">Reliability</h2>
                <select
                  value={healthSort}
                  onChange={(e) => setHealthSort(e.target.value as 'failures' | 'success' | 'flaky')}
                  className="text-xs px-2 py-1 bg-bg-3 border border-bd-0 rounded text-fg-1"
                >
                  <option value="failures">Sort: failures</option>
                  <option value="success">Sort: success</option>
                  <option value="flaky">Sort: flaky</option>
                </select>
              </div>
              <CanonicalTable
                columns={cronHealthColumns}
                rows={sortedHealthJobs}
                rowKey={(row) => row.id}
                density="compact"
                emptyState="No cron health data"
              />
            </div>
          </>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <HealthCard label="Projected tokens (30d)" value={formatTokenCount(projectedTotals30d.tokens)} />
          <HealthCard label="Projected cost (30d)" value={formatUsdMicros(projectedTotals30d.cost)} />
          <HealthCard label="Models resolved" value={String(Array.from(costEstimateByJob.values()).filter((v) => v.modelId).length)} />
          <HealthCard
            label="Estimates available"
            value={String(Array.from(costEstimateByJob.values()).filter((v) => v.projectedTokens30d !== null).length)}
          />
        </div>

        {error && (
          <div className="p-3 bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] text-status-danger text-sm">
            {error}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-fg-3 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Loading crons...</span>
          </div>
        )}

        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
          <CanonicalTable
            columns={cronColumns}
            rows={filteredCronJobs}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelectedId(row.id)}
            selectedKey={selectedId}
            density="compact"
            emptyState={
              <EmptyState
                icon={<Clock className="w-8 h-8" />}
                title={searchText.trim() ? 'No matching jobs' : 'No scheduled jobs'}
                description={searchText.trim() ? 'Try a different search term.' : 'Sync with OpenClaw to import jobs.'}
              />
            }
          />
        </div>

        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-fg-1" />
              <h2 className="text-sm font-medium text-fg-0">Schedule Calendar</h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] overflow-hidden">
                {(['day', 'week', 'month', 'year'] as const).map((view) => (
                  <button
                    key={view}
                    onClick={() => setCalendarView(view)}
                    className={cn(
                      'px-2 py-1.5 text-xs capitalize',
                      calendarView === view ? 'bg-bg-2 text-fg-0' : 'text-fg-2 hover:text-fg-1'
                    )}
                  >
                    {view}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setCalendarAnchor(startOfUtcDay(new Date()))}
                className="px-2.5 py-1.5 text-xs bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-1 hover:text-fg-0"
              >
                Today
              </button>

              <button
                onClick={() => shiftCalendar(-1)}
                className="p-1.5 rounded hover:bg-bg-3 text-fg-2"
                aria-label="Previous"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => shiftCalendar(1)}
                className="p-1.5 rounded hover:bg-bg-3 text-fg-2"
                aria-label="Next"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="text-xs text-fg-2 space-y-1">
            <div>
              {calendarLabel} ({userTimeZone}). Counts include enabled jobs that match each day.
            </div>
            {(calendarView === 'day' || calendarView === 'week') && (
              <div>Now: {nowLocalLabel}</div>
            )}
          </div>

          {calendarView === 'year' ? (
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
              {yearBuckets.map((bucket) => (
                <button
                  key={bucket.monthIndex}
                  onClick={() => {
                    setCalendarView('month')
                    setCalendarAnchor(new Date(Date.UTC(calendarAnchor.getUTCFullYear(), bucket.monthIndex, 1)))
                  }}
                  className={cn(
                    'rounded-[var(--radius-md)] border p-3 text-left transition-colors',
                    bucket.totalRuns > 0
                      ? 'border-status-info/40 bg-status-info/10 hover:bg-status-info/20'
                      : 'border-bd-0 bg-bg-3/40 hover:bg-bg-3/60'
                  )}
                >
                  <div className="text-xs text-fg-1">{bucket.monthLabel}</div>
                  <div className="mt-1 text-lg font-semibold text-fg-0">{bucket.totalRuns}</div>
                  <div className="text-[11px] text-fg-2">scheduled runs</div>
                  <div className="mt-2 text-[11px] text-fg-2 truncate">
                    {bucket.jobs[0] ? `${bucket.jobs[0].job.name} (${bucket.jobs[0].runs})` : 'No scheduled jobs'}
                  </div>
                </button>
              ))}
            </div>
          ) : calendarView === 'month' ? (
            <div className="space-y-2">
              <div className="grid grid-cols-7 gap-2 text-xs text-fg-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
                  <div key={label} className="text-center">{label}</div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-2">
                {monthGridCells(new Date(Date.UTC(calendarAnchor.getUTCFullYear(), calendarAnchor.getUTCMonth(), 1))).map((cell, idx) => {
                  if (!cell.date) {
                    return <div key={`empty-${idx}`} className="h-24 rounded border border-bd-0/40 bg-bg-3/30" />
                  }

                  const key = utcDayKey(cell.date)
                  const bucket = dayBucketsByKey.get(key)
                  const selected = selectedCalendarDay === key

                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedCalendarDay(key)}
                      className={cn(
                        'h-24 rounded border text-left p-2 transition-colors',
                        selected && 'ring-1 ring-status-info/60',
                        bucket && bucket.totalRuns > 0
                          ? 'border-status-info/40 bg-status-info/10 hover:bg-status-info/20'
                          : 'border-bd-0 bg-bg-3/40 hover:bg-bg-3/60'
                      )}
                    >
                      <div className="text-xs text-fg-1">{cell.date.getUTCDate()}</div>
                      <div className="mt-1 text-[11px] text-fg-2">{bucket?.totalRuns ?? 0} runs</div>
                      <div className="mt-1 text-[11px] text-fg-2 truncate">
                        {bucket?.jobs[0]?.job.name ?? '—'}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className={cn('grid gap-2', calendarView === 'week' ? 'grid-cols-1 md:grid-cols-7' : 'grid-cols-1')}>
              {dayBuckets.map((bucket) => {
                const selected = selectedCalendarDay === bucket.dayKey
                const nextLocalRun = bucket.jobs
                  .map((entry) => entry.job.nextRunAt)
                  .find((runAt): runAt is Date => Boolean(runAt && isSameLocalDay(runAt, bucket.day)))
                return (
                  <button
                    key={bucket.dayKey}
                    onClick={() => setSelectedCalendarDay(bucket.dayKey)}
                    className={cn(
                      'rounded-[var(--radius-md)] border p-3 text-left transition-colors',
                      selected && 'ring-1 ring-status-info/60',
                      bucket.totalRuns > 0
                        ? 'border-status-info/40 bg-status-info/10 hover:bg-status-info/20'
                        : 'border-bd-0 bg-bg-3/40 hover:bg-bg-3/60'
                    )}
                  >
                    <div className="text-xs text-fg-1">
                      {bucket.day.toLocaleDateString(undefined, {
                        weekday: calendarView === 'week' ? 'short' : 'long',
                        month: 'short',
                        day: 'numeric',
                        timeZone: 'UTC',
                      })}
                    </div>
                    <div className="mt-1 text-lg font-semibold text-fg-0">{bucket.totalRuns}</div>
                    <div className="text-[11px] text-fg-2">scheduled runs</div>
                    <div className="text-[11px] text-fg-2">next: {formatLocalTime(nextLocalRun)}</div>
                    <div className="mt-1 text-[11px] text-fg-2 truncate">
                      {bucket.jobs[0] ? `${bucket.jobs[0].job.name} (${bucket.jobs[0].runs})` : 'No scheduled jobs'}
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {calendarView !== 'year' && selectedDayBucket && (
            <div className="rounded-[var(--radius-md)] border border-bd-0 bg-bg-3/40">
              <div className="px-3 py-2 border-b border-bd-0 flex items-center justify-between">
                <div className="text-xs text-fg-1">
                  {selectedDayBucket.day.toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}
                </div>
                <div className="text-xs text-fg-2">{selectedDayBucket.totalRuns} runs</div>
              </div>

              {selectedDayBucket.jobs.length === 0 ? (
                <div className="px-3 py-4 text-sm text-fg-2">No scheduled runs.</div>
              ) : (
                <div className="divide-y divide-bd-0/60">
                  {selectedDayBucket.jobs.map(({ job, runs }) => {
                    const estimate = costEstimateByJob.get(job.id)

                    return (
                      <button
                        key={job.id}
                        onClick={() => setSelectedId(job.id)}
                        className="w-full px-3 py-2 text-left hover:bg-bg-2/80 transition-colors"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm text-fg-0">{job.name}</div>
                          <div className="text-xs text-fg-2">{runs} run{runs === 1 ? '' : 's'}</div>
                        </div>
                        <div className="mt-1 grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px] text-fg-2">
                          <span>Model: {estimate?.modelLabel ?? 'Unknown'}</span>
                          <span>Next: {formatLocalTime(job.nextRunAt)}</span>
                          <span>Tokens/run: {formatTokenCount(estimate?.tokensPerRun ?? null)}</span>
                          <span>Cost/run: {formatUsdMicros(estimate?.costMicrosPerRun ?? null)}</span>
                          <span className="md:col-span-2">Confidence: {estimate?.confidence ?? 'none'}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Detail Drawer */}
      <RightDrawer
        open={!!selectedJob}
        onClose={() => setSelectedId(undefined)}
        title={selectedJob?.name}
        description={selectedJob?.description}
      >
        {selectedJob && (
          <CronDetail
            job={selectedJob}
            estimate={costEstimateByJob.get(selectedJob.id)}
            onClose={() => setSelectedId(undefined)}
            onUpdated={refreshJobs}
            onDeleted={handleJobDeleted}
          />
        )}
      </RightDrawer>

      {/* Create Job Modal */}
      <CreateCronJobModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onCreated={handleJobCreated}
      />
    </>
  )
}

function CronDetail({
  job,
  estimate,
  onClose,
  onUpdated,
  onDeleted,
}: {
  job: CronJobRow
  estimate?: CronCostEstimate
  onClose: () => void
  onUpdated: () => void | Promise<void>
  onDeleted?: () => void
}) {
  const [actionInProgress, setActionInProgress] = useState<'run' | 'toggle' | 'delete' | 'save' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editMode, setEditMode] = useState<EditMode>('every')
  const [everyValue, setEveryValue] = useState('20m')
  const [cronValue, setCronValue] = useState('* * * * *')
  const [tzValue, setTzValue] = useState('')
  const [atValue, setAtValue] = useState('')

  useEffect(() => {
    const schedule = job.raw.schedule

    if (schedule.kind === 'every') {
      setEditMode('every')
      setEveryValue(
        typeof schedule.everyMs === 'number' ? formatDurationShort(schedule.everyMs) : '20m'
      )
    } else if (schedule.kind === 'cron') {
      setEditMode('cron')
      setCronValue(schedule.expr ?? '* * * * *')
      setTzValue(schedule.tz ?? '')
    } else if (schedule.kind === 'at') {
      setEditMode('at')
      setAtValue(
        typeof schedule.atMs === 'number' ? new Date(schedule.atMs).toISOString() : ''
      )
    }
  }, [job.id, job.raw.schedule])

  async function handleRunNow() {
    setActionInProgress('run')
    setError(null)

    try {
      const res = await fetch(`/api/openclaw/cron/${job.id}/run`, { method: 'POST' })
      const data = await res.json()

      if (data.status === 'unavailable') {
        setError(data.error ?? 'Failed to run job')
      } else {
        await onUpdated()
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run job')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleToggleEnabled() {
    setActionInProgress('toggle')
    setError(null)

    const endpoint = job.enabled ? 'disable' : 'enable'

    try {
      const res = await fetch(`/api/openclaw/cron/${job.id}/${endpoint}`, { method: 'POST' })
      const data = await res.json()

      if (data.status === 'unavailable') {
        setError(data.error ?? `Failed to ${endpoint} job`)
      } else {
        await onUpdated()
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to ${endpoint} job`)
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }

    setActionInProgress('delete')
    setError(null)

    try {
      const res = await fetch(`/api/openclaw/cron/${job.id}/delete`, { method: 'POST' })
      const data = await res.json()

      if (data.status === 'unavailable') {
        setError(data.error ?? 'Failed to delete job')
        setConfirmDelete(false)
      } else {
        await onUpdated()
        onDeleted?.()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete job')
      setConfirmDelete(false)
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleSaveSchedule() {
    setActionInProgress('save')
    setError(null)

    try {
      const body: Record<string, string> = { mode: editMode }

      if (editMode === 'every') {
        if (!everyValue.trim()) throw new Error('Interval is required')
        body.every = everyValue.trim()
      }

      if (editMode === 'cron') {
        if (!cronValue.trim()) throw new Error('Cron expression is required')
        body.cron = cronValue.trim()
        if (tzValue.trim()) body.tz = tzValue.trim()
      }

      if (editMode === 'at') {
        if (!atValue.trim()) throw new Error('One-time schedule value is required')
        body.at = atValue.trim()
      }

      const res = await fetch(`/api/openclaw/cron/${job.id}/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (data.status === 'unavailable') {
        setError(data.error ?? 'Failed to save schedule')
      } else {
        await onUpdated()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule')
    } finally {
      setActionInProgress(null)
    }
  }

  const isLoading = actionInProgress !== null

  return (
    <div className="space-y-6">
      {/* Status */}
      <div className="flex items-center gap-3">
        <span className={cn(
          'px-2 py-0.5 text-xs rounded',
          job.enabled
            ? 'bg-status-success/10 text-status-success'
            : 'bg-fg-3/10 text-fg-3'
        )}>
          {job.enabled ? 'Enabled' : 'Disabled'}
        </span>
        {job.lastStatus && (
          <StatusPill
            tone={job.lastStatus === 'success' ? 'success' : job.lastStatus === 'failed' ? 'danger' : 'progress'}
            label={job.lastStatus}
          />
        )}
      </div>

      {/* Schedule */}
      <PageSection title="Schedule">
        <div className="space-y-3">
          <div className="p-3 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0">
            <div className="text-sm text-fg-0 font-medium">{job.schedule}</div>
            <div className="text-xs text-fg-2 mt-1">{job.frequencyText}</div>
            <code className="font-mono text-xs text-fg-2 mt-2 block">{job.rawScheduleText}</code>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <dt className="text-fg-3">Kind</dt>
            <dd className="text-fg-1 font-mono">{job.raw.schedule.kind}</dd>
            <dt className="text-fg-3">Agent</dt>
            <dd className="text-fg-1 font-mono">{job.raw.agentId ?? '—'}</dd>
            <dt className="text-fg-3">Session</dt>
            <dd className="text-fg-1 font-mono">{job.raw.sessionTarget ?? '—'}</dd>
            <dt className="text-fg-3">Wake</dt>
            <dd className="text-fg-1 font-mono">{job.raw.wakeMode ?? '—'}</dd>
          </dl>
        </div>
      </PageSection>

      {/* Edit Schedule */}
      <PageSection title="Edit Frequency">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setEditMode('every')}
              disabled={isLoading}
              className={cn(
                'px-2.5 py-1 text-xs rounded-[var(--radius-md)] border-0 transition-colors',
                editMode === 'every'
                  ? 'bg-status-info/20 text-status-info'
                  : 'bg-bg-3 text-fg-2 hover:text-fg-1'
              )}
            >
              Every
            </button>
            <button
              onClick={() => setEditMode('cron')}
              disabled={isLoading}
              className={cn(
                'px-2.5 py-1 text-xs rounded-[var(--radius-md)] border-0 transition-colors',
                editMode === 'cron'
                  ? 'bg-status-info/20 text-status-info'
                  : 'bg-bg-3 text-fg-2 hover:text-fg-1'
              )}
            >
              Cron
            </button>
            <button
              onClick={() => setEditMode('at')}
              disabled={isLoading}
              className={cn(
                'px-2.5 py-1 text-xs rounded-[var(--radius-md)] border-0 transition-colors',
                editMode === 'at'
                  ? 'bg-status-info/20 text-status-info'
                  : 'bg-bg-3 text-fg-2 hover:text-fg-1'
              )}
            >
              One-time
            </button>
          </div>

          {editMode === 'every' && (
            <div>
              <label className="block text-xs text-fg-2 mb-1">Interval (e.g. `10m`, `1h`, `1d`)</label>
              <input
                value={everyValue}
                onChange={(e) => setEveryValue(e.target.value)}
                disabled={isLoading}
                className="w-full px-3 py-2 text-sm font-mono bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:ring-1 focus:ring-status-info/50"
              />
            </div>
          )}

          {editMode === 'cron' && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs text-fg-2 mb-1">Cron expression</label>
                <input
                  value={cronValue}
                  onChange={(e) => setCronValue(e.target.value)}
                  disabled={isLoading}
                  className="w-full px-3 py-2 text-sm font-mono bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:ring-1 focus:ring-status-info/50"
                />
              </div>
              <div>
                <label className="block text-xs text-fg-2 mb-1">Timezone (optional)</label>
                <input
                  value={tzValue}
                  onChange={(e) => setTzValue(e.target.value)}
                  disabled={isLoading}
                  placeholder="Europe/Zurich"
                  className="w-full px-3 py-2 text-sm font-mono bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:ring-1 focus:ring-status-info/50"
                />
              </div>
            </div>
          )}

          {editMode === 'at' && (
            <div>
              <label className="block text-xs text-fg-2 mb-1">One-time time (ISO or relative, e.g. `+20m`)</label>
              <input
                value={atValue}
                onChange={(e) => setAtValue(e.target.value)}
                disabled={isLoading}
                className="w-full px-3 py-2 text-sm font-mono bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 focus:outline-none focus:ring-1 focus:ring-status-info/50"
              />
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleSaveSchedule}
              disabled={isLoading}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium border-0 transition-colors',
                'bg-status-info/20 text-status-info hover:bg-status-info/30',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              {actionInProgress === 'save' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save Schedule
            </button>
          </div>
        </div>
      </PageSection>

      {/* Actions */}
      <PageSection title="Actions">
        {error && (
          <div className="mb-3 p-2 bg-status-error/10 rounded text-status-error text-sm">
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleRunNow}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium border-0 transition-colors',
              'bg-accent/10 text-accent hover:bg-accent/20',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {actionInProgress === 'run' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Run Now
          </button>
          <button
            onClick={handleToggleEnabled}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium border-0 transition-colors',
              job.enabled
                ? 'bg-status-warning/10 text-status-warning hover:bg-status-warning/20'
                : 'bg-status-success/10 text-status-success hover:bg-status-success/20',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {actionInProgress === 'toggle' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : job.enabled ? (
              <Pause className="w-3.5 h-3.5" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {job.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            onClick={handleDelete}
            disabled={isLoading}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium border-0 transition-colors',
              confirmDelete
                ? 'bg-status-danger text-white hover:bg-status-danger/90'
                : 'bg-status-danger/10 text-status-danger hover:bg-status-danger/20',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {actionInProgress === 'delete' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            {confirmDelete ? 'Confirm Delete' : 'Delete'}
          </button>
        </div>
        {confirmDelete && (
          <p className="mt-2 text-xs text-status-danger">
            Click again to permanently delete this job
          </p>
        )}
      </PageSection>

      {/* Stats */}
      {estimate && (
        <PageSection title="Estimated Token Cost (30d)">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="text-fg-2">Model</dt>
            <dd className="text-fg-1 font-mono text-xs">{estimate.modelLabel}</dd>
            <dt className="text-fg-2">Est. Runs</dt>
            <dd className="text-fg-1 font-mono">{estimate.estimatedRuns30d}</dd>
            <dt className="text-fg-2">Tokens / Run</dt>
            <dd className="text-fg-1 font-mono">{formatTokenCount(estimate.tokensPerRun)}</dd>
            <dt className="text-fg-2">Cost / Run</dt>
            <dd className="text-fg-1 font-mono">{formatUsdMicros(estimate.costMicrosPerRun)}</dd>
            <dt className="text-fg-2">Projected Tokens</dt>
            <dd className="text-fg-1 font-mono">{formatTokenCount(estimate.projectedTokens30d)}</dd>
            <dt className="text-fg-2">Projected Cost</dt>
            <dd className="text-fg-1 font-mono">{formatUsdMicros(estimate.projectedCostMicros30d)}</dd>
          </dl>
          <p className="mt-2 text-xs text-fg-2">
            Approximation based on agent/model usage over the last 30 days and this job&apos;s schedule.
          </p>
        </PageSection>
      )}

      <PageSection title="Statistics">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-fg-2">Total Runs</dt>
          <dd className="text-fg-1 font-mono">{job.runCount}</dd>
          <dt className="text-fg-2">Last Run</dt>
          <dd className="text-fg-1 font-mono text-xs">
            {job.lastRunAt ? formatRelativeTime(job.lastRunAt) : 'Never'}
          </dd>
          <dt className="text-fg-2">Next Run</dt>
          <dd className="text-fg-1 font-mono text-xs">
            {job.nextRunAt ? formatRelativeTime(job.nextRunAt) : '—'}
          </dd>
        </dl>
      </PageSection>
    </div>
  )
}

function HealthCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 bg-bg-2 rounded-[var(--radius-md)] border border-bd-0">
      <div className="text-xs text-fg-2">{label}</div>
      <div className="mt-1 text-lg font-semibold text-fg-0">{value}</div>
    </div>
  )
}

function formatRelativeTime(date: Date | string): string {
  const now = new Date()
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = d.getTime() - now.getTime()
  const absDiff = Math.abs(diff)
  const mins = Math.floor(absDiff / 60000)
  const hours = Math.floor(absDiff / 3600000)
  const days = Math.floor(absDiff / 86400000)

  if (diff > 0) {
    // Future
    if (mins < 60) return `in ${mins}m`
    if (hours < 24) return `in ${hours}h`
    return `in ${days}d`
  } else {
    // Past
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }
}

// ============================================================================
// CREATE CRON JOB MODAL
// ============================================================================

interface CreateCronJobModalProps {
  isOpen: boolean
  onClose: () => void
  onCreated: () => void | Promise<void>
}

function CreateCronJobModal({ isOpen, onClose, onCreated }: CreateCronJobModalProps) {
  const [name, setName] = useState('')
  const [schedule, setSchedule] = useState('0 * * * *')
  const [command, setCommand] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName('')
      setSchedule('0 * * * *')
      setCommand('')
      setEnabled(true)
      setError(null)
      setTimeout(() => nameInputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, isSubmitting, onClose])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !schedule.trim() || !command.trim()) {
      setError('All fields are required')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/openclaw/cron', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, schedule, command, enabled }),
      })

      const data = await response.json()

      if (data.status === 'unavailable') {
        setError(data.error || 'Failed to create cron job')
      } else {
        await onCreated()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create cron job')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={!isSubmitting ? onClose : undefined}
      />

      {/* Modal */}
      <div className="relative bg-bg-1 border border-bd-1 rounded-[var(--radius-lg)] shadow-2xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-bd-0">
          <h2 className="text-base font-medium text-fg-0">New Cron Job</h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 text-fg-2 hover:text-fg-0 hover:bg-bg-3 rounded-[var(--radius-md)] transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="cron-name" className="block text-xs font-medium text-fg-1 mb-1.5">
              Name
            </label>
            <input
              ref={nameInputRef}
              id="cron-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., daily-backup"
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
            />
          </div>

          {/* Schedule */}
          <div>
            <label htmlFor="cron-schedule" className="block text-xs font-medium text-fg-1 mb-1.5">
              Schedule (cron expression)
            </label>
            <input
              id="cron-schedule"
              type="text"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="0 * * * *"
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-sm font-mono bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
            />
            <p className="mt-1 text-xs text-fg-2">
              minute hour day month weekday (e.g., &quot;0 * * * *&quot; = every hour)
            </p>
          </div>

          {/* Command */}
          <div>
            <label htmlFor="cron-command" className="block text-xs font-medium text-fg-1 mb-1.5">
              Command
            </label>
            <textarea
              id="cron-command"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="openclaw run --task cleanup"
              rows={3}
              disabled={isSubmitting}
              className="w-full px-3 py-2 text-sm font-mono bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-2 focus:outline-none focus:ring-1 focus:ring-status-info/50 resize-none disabled:opacity-50"
            />
          </div>

          {/* Enabled Toggle */}
          <div className="flex items-center justify-between">
            <label htmlFor="cron-enabled" className="text-xs font-medium text-fg-1">
              Enable job immediately
            </label>
            <button
              type="button"
              id="cron-enabled"
              onClick={() => setEnabled(!enabled)}
              disabled={isSubmitting}
              className={cn(
                'relative w-10 h-5 rounded-full transition-colors',
                enabled ? 'bg-status-success' : 'bg-bg-3',
                'disabled:opacity-50'
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
                  enabled && 'translate-x-5'
                )}
              />
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] px-3 py-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-fg-1 hover:text-fg-0 bg-bg-3 rounded-[var(--radius-md)] border border-bd-0 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim() || !schedule.trim() || !command.trim()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-bg-0 bg-status-info hover:bg-status-info/90 rounded-[var(--radius-md)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isSubmitting ? 'Creating...' : 'Create Job'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
