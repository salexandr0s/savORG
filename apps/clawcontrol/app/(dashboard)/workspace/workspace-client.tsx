'use client'

import { useState, useCallback, useEffect, useMemo, type CSSProperties } from 'react'
import {
  PageHeader,
  EmptyState,
  TypedConfirmModal,
  Button,
  SegmentedToggle,
  DropdownMenu,
  SelectDropdown,
} from '@clawcontrol/ui'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import { RightDrawer } from '@/components/shell/right-drawer'
import { MarkdownEditor } from '@/components/editors/markdown-editor'
import { YamlEditor } from '@/components/editors/yaml-editor'
import { JsonEditor } from '@/components/editors/json-editor'
import { workspaceApi, workspaceFavoritesApi, workspaceCalendarApi, HttpError } from '@/lib/http'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { useSettings } from '@/lib/settings-context'
import type { ActionKind } from '@clawcontrol/core'
import type { WorkspaceFileDTO } from '@/lib/data'
import { cn } from '@/lib/utils'
import {
  FolderTree,
  Folder,
  FileText,
  ChevronRight,
  FileCode,
  Shield,
  Plus,
  FilePlus,
  FolderPlus,
  Trash2,
  X,
  Star,
  CalendarDays,
  List,
  ChevronLeft,
  Search,
} from 'lucide-react'

// ============================================================================
// TYPES
// ============================================================================

interface Props {
  initialFiles: WorkspaceFileDTO[]
}

interface FileWithContent extends WorkspaceFileDTO {
  content?: string
}

type WorkspaceSort = 'name' | 'recentlyEdited' | 'newestCreated' | 'oldestCreated'

interface FavoritesDoc {
  favorites: string[]
  recents: Array<{ path: string; touchedAt: string }>
  pinToday?: boolean
}

interface CalendarDay {
  day: string
  count: number
  files: Array<{
    id: string
    path: string
    name: string
    createdAt: string | null
    lastEditedAt: string
  }>
}

type WorkspaceCalendarView = 'day' | 'week' | 'month' | 'year'

type TimelineEvent = {
  key: string
  file: CalendarDay['files'][number]
  minuteOfDay: number
}

type LaidOutTimelineEvent = TimelineEvent & {
  lane: number
  laneCount: number
  clusterId: number
  topPercent: number
  heightPercent: number
}

type TimelineOverflowBadge = {
  key: string
  clusterId: number
  hiddenCount: number
  topPercent: number
  primaryFileId: string
}

type TimelineRenderData = {
  visibleEvents: LaidOutTimelineEvent[]
  overflowBadges: TimelineOverflowBadge[]
}

const TIMELINE_HEIGHT_PX = 1280
const TIMELINE_EVENT_MIN_HEIGHT_PERCENT = 1.2
const TIMELINE_WEEK_MAX_COLUMNS = 3
const TIMELINE_DAY_MAX_COLUMNS = 4

const TIMELINE_EVENT_CHROME: CSSProperties = {
  borderColor: 'rgb(59 130 246 / 0.46)',
  background: 'linear-gradient(135deg, rgb(59 130 246 / 0.26) 0%, rgb(37 99 235 / 0.14) 100%)',
  boxShadow: '0 8px 18px rgb(2 12 24 / 0.42)',
}

const TIMELINE_OVERFLOW_CHROME: CSSProperties = {
  borderColor: 'rgb(71 85 105 / 0.62)',
  background: 'linear-gradient(135deg, rgb(30 41 59 / 0.9) 0%, rgb(15 23 42 / 0.82) 100%)',
  boxShadow: '0 8px 16px rgb(2 6 23 / 0.45)',
}

// Protected file mapping
const PROTECTED_FILES: Record<string, { actionKind: ActionKind; label: string }> = {
  'AGENTS.md': { actionKind: 'config.agents_md.edit', label: 'Global Agent Configuration' },
  'routing.yaml': { actionKind: 'config.routing_template.edit', label: 'Routing Template' },
}

function toEntryPath(file: WorkspaceFileDTO): string {
  return file.path === '/' ? `/${file.name}` : `${file.path}/${file.name}`
}

function monthKeyFromLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function addLocalDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta)
}

function addLocalMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function addLocalYears(date: Date, delta: number): Date {
  return new Date(date.getFullYear() + delta, date.getMonth(), 1)
}

function startOfLocalWeek(date: Date): Date {
  const day = startOfLocalDay(date)
  return addLocalDays(day, -day.getDay())
}

function listLocalDaysInRange(start: Date, end: Date): Date[] {
  const out: Date[] = []
  let cursor = startOfLocalDay(start)
  const endDay = startOfLocalDay(end)
  while (cursor.getTime() <= endDay.getTime()) {
    out.push(cursor)
    cursor = addLocalDays(cursor, 1)
  }
  return out
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
  )
}

function formatMinuteLabel(day: Date, minuteOfDay: number): string {
  const safeMinute = Math.max(0, Math.min(1439, Math.round(minuteOfDay)))
  const hours = Math.floor(safeMinute / 60)
  const minutes = safeMinute % 60
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    hours,
    minutes
  ).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function dayFromDayKey(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map((value) => Number(value))
  return new Date(year, Math.max(0, month - 1), day)
}

function minuteOfDayFromDate(date: Date | null): number | null {
  if (!date || Number.isNaN(date.getTime())) return null
  return date.getHours() * 60 + date.getMinutes()
}

function representativeMinuteForFile(file: CalendarDay['files'][number], day: Date): number {
  const edited = minuteOfDayFromDate(new Date(file.lastEditedAt))
  const created = minuteOfDayFromDate(file.createdAt ? new Date(file.createdAt) : null)

  if (file.lastEditedAt) {
    const editedDate = new Date(file.lastEditedAt)
    if (isSameLocalDay(editedDate, day) && edited !== null) return edited
  }
  if (file.createdAt) {
    const createdDate = new Date(file.createdAt)
    if (isSameLocalDay(createdDate, day) && created !== null) return created
  }
  if (edited !== null) return edited
  if (created !== null) return created
  return 9 * 60
}

function buildTimelineEventsForDay(day: Date, files: CalendarDay['files']): TimelineEvent[] {
  const dayKey = localDayKey(day)

  return files.map((file, idx) => ({
    key: `${file.id}:${dayKey}:${idx}`,
    file,
    minuteOfDay: representativeMinuteForFile(file, day),
  })).sort((a, b) => {
    if (a.minuteOfDay !== b.minuteOfDay) return a.minuteOfDay - b.minuteOfDay
    return a.file.name.localeCompare(b.file.name)
  })
}

function layoutTimelineEvents(
  events: TimelineEvent[],
  eventDurationMinutes = 12
): LaidOutTimelineEvent[] {
  if (events.length === 0) return []

  type ActiveEvent = { endMinute: number; lane: number; index: number }
  type WorkingEvent = {
    event: TimelineEvent
    startMinute: number
    endMinute: number
    lane: number
    clusterId: number
  }

  const sorted = [...events].sort((a, b) => a.minuteOfDay - b.minuteOfDay || a.file.name.localeCompare(b.file.name))
  const working: WorkingEvent[] = []
  const active: ActiveEvent[] = []
  const clusterLaneCount = new Map<number, number>()
  let clusterId = -1

  for (const event of sorted) {
    const startMinute = Math.max(0, Math.min(1439, event.minuteOfDay))
    const endMinute = Math.min(1440, startMinute + Math.max(15, eventDurationMinutes))

    for (let i = active.length - 1; i >= 0; i--) {
      if (active[i].endMinute <= startMinute) active.splice(i, 1)
    }

    if (active.length === 0) clusterId += 1

    const usedLanes = new Set(active.map((item) => item.lane))
    let lane = 0
    while (usedLanes.has(lane)) lane += 1

    const index = working.push({
      event,
      startMinute,
      endMinute,
      lane,
      clusterId,
    }) - 1

    active.push({ endMinute, lane, index })
    const laneCount = Math.max(clusterLaneCount.get(clusterId) ?? 0, lane + 1)
    clusterLaneCount.set(clusterId, laneCount)
  }

  return working.map((item) => {
    const laneCount = Math.max(1, clusterLaneCount.get(item.clusterId) ?? 1)
    const topPercent = (item.startMinute / 1440) * 100
    const rawHeightPercent = Math.max(
      (item.endMinute - item.startMinute) / 1440 * 100,
      TIMELINE_EVENT_MIN_HEIGHT_PERCENT
    )
    const remainingPercent = Math.max(0, 100 - topPercent)
    const heightPercent = Math.max(0.06, Math.min(rawHeightPercent, remainingPercent))

    return {
      ...item.event,
      lane: item.lane,
      laneCount,
      clusterId: item.clusterId,
      topPercent,
      heightPercent,
    }
  })
}

function timelineEventDurationForCount(eventCount: number): number {
  if (eventCount >= 48) return 8
  if (eventCount >= 32) return 10
  if (eventCount >= 20) return 12
  if (eventCount >= 10) return 14
  return 18
}

function buildTimelineRenderData(events: LaidOutTimelineEvent[], maxColumns: number): TimelineRenderData {
  const visibleEvents: LaidOutTimelineEvent[] = []
  const overflowByCluster = new Map<number, TimelineOverflowBadge>()

  for (const event of events) {
    if (event.lane < maxColumns) {
      visibleEvents.push(event)
      continue
    }

    const existing = overflowByCluster.get(event.clusterId)
    if (existing) {
      existing.hiddenCount += 1
      if (event.topPercent < existing.topPercent) {
        existing.topPercent = event.topPercent
        existing.primaryFileId = event.file.id
      }
      continue
    }

    overflowByCluster.set(event.clusterId, {
      key: `overflow:${event.key}`,
      clusterId: event.clusterId,
      hiddenCount: 1,
      topPercent: event.topPercent,
      primaryFileId: event.file.id,
    })
  }

  const overflowBadges = [...overflowByCluster.values()].sort((a, b) => a.topPercent - b.topPercent)
  return { visibleEvents, overflowBadges }
}

function timelineColumnInsets(
  event: LaidOutTimelineEvent,
  maxColumns: number,
  insetPx: number
): { left: string; right: string; columns: number } {
  const columns = Math.min(Math.max(event.laneCount, 1), maxColumns)
  const safeLane = Math.max(0, Math.min(event.lane, columns - 1))
  const leftPercent = (safeLane / columns) * 100
  const rightPercent = ((columns - safeLane - 1) / columns) * 100
  return {
    left: `calc(${leftPercent}% + ${insetPx}px)`,
    right: `calc(${rightPercent}% + ${insetPx}px)`,
    columns,
  }
}

function rangeForLocalCalendarView(anchor: Date, view: WorkspaceCalendarView): { start: Date; end: Date } {
  if (view === 'day') {
    const start = startOfLocalDay(anchor)
    return { start, end: endOfLocalDay(start) }
  }

  if (view === 'week') {
    const start = startOfLocalWeek(anchor)
    return { start, end: endOfLocalDay(addLocalDays(start, 6)) }
  }

  if (view === 'month') {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59, 999)
    return { start, end }
  }

  const start = new Date(anchor.getFullYear(), 0, 1)
  const end = new Date(anchor.getFullYear(), 11, 31, 23, 59, 59, 999)
  return { start, end }
}

function monthsForLocalCalendarView(anchor: Date, view: WorkspaceCalendarView): string[] {
  const range = rangeForLocalCalendarView(anchor, view)
  const out: string[] = []
  let cursor = new Date(range.start.getFullYear(), range.start.getMonth(), 1)
  const end = new Date(range.end.getFullYear(), range.end.getMonth(), 1)

  while (cursor.getTime() <= end.getTime()) {
    out.push(monthKeyFromLocalDate(cursor))
    cursor = addLocalMonths(cursor, 1)
  }

  return out
}

function monthGridCellsLocal(anchorMonth: Date): Array<{ date: Date | null }> {
  const start = new Date(anchorMonth.getFullYear(), anchorMonth.getMonth(), 1)
  const end = new Date(anchorMonth.getFullYear(), anchorMonth.getMonth() + 1, 0)
  const leading = start.getDay()
  const total = end.getDate()

  const cells: Array<{ date: Date | null }> = []
  for (let i = 0; i < leading; i++) cells.push({ date: null })
  for (let day = 1; day <= total; day++) {
    cells.push({ date: new Date(anchorMonth.getFullYear(), anchorMonth.getMonth(), day) })
  }

  while (cells.length % 7 !== 0) cells.push({ date: null })
  return cells
}

// ============================================================================
// COMPONENT
// ============================================================================

export function WorkspaceClient({ initialFiles }: Props) {
  const { skipTypedConfirm } = useSettings()
  const [currentPath, setCurrentPath] = useState('/')
  const [filesByPath, setFilesByPath] = useState<Record<string, WorkspaceFileDTO[]>>({
    '/': initialFiles,
  })

  const [selectedFile, setSelectedFile] = useState<FileWithContent | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')

  const [createModalOpen, setCreateModalOpen] = useState<'file' | 'folder' | null>(null)
  const [newName, setNewName] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [sortBy, setSortBy] = useState<WorkspaceSort>('name')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list')
  const [favoritesDoc, setFavoritesDoc] = useState<FavoritesDoc>({ favorites: [], recents: [] })
  const [calendarView, setCalendarView] = useState<WorkspaceCalendarView>('month')
  const [calendarAnchor, setCalendarAnchor] = useState<Date>(() => startOfLocalDay(new Date()))
  const [calendarByMonth, setCalendarByMonth] = useState<Record<string, CalendarDay[]>>({})
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [nowMs, setNowMs] = useState<number>(() => Date.now())

  const protectedAction = useProtectedAction({ skipTypedConfirm })

  const files = useMemo(() => {
    const base = [...(filesByPath[currentPath] ?? [])]

    base.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1

      if (sortBy === 'recentlyEdited') {
        return new Date(b.lastEditedAt).getTime() - new Date(a.lastEditedAt).getTime()
      }

      if (sortBy === 'newestCreated') {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : Number.NEGATIVE_INFINITY
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : Number.NEGATIVE_INFINITY
        return bTime - aTime
      }

      if (sortBy === 'oldestCreated') {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : Number.POSITIVE_INFINITY
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : Number.POSITIVE_INFINITY
        return aTime - bTime
      }

      return a.name.localeCompare(b.name)
    })

    return base
  }, [filesByPath, currentPath, sortBy])

  const normalizedSearch = useMemo(() => searchQuery.trim().toLowerCase(), [searchQuery])
  const filteredFiles = useMemo(() => {
    if (!normalizedSearch) return files

    return files.filter((file) => {
      const entryPath = toEntryPath(file).toLowerCase()
      return file.name.toLowerCase().includes(normalizedSearch) || entryPath.includes(normalizedSearch)
    })
  }, [files, normalizedSearch])

  const favoriteSet = useMemo(() => new Set(favoritesDoc.favorites), [favoritesDoc.favorites])
  const recentsByPath = useMemo(
    () => new Map(favoritesDoc.recents.map((item) => [item.path, item.touchedAt])),
    [favoritesDoc.recents]
  )

  const favoriteEntries = useMemo(
    () => filteredFiles.filter((file) => favoriteSet.has(toEntryPath(file))),
    [filteredFiles, favoriteSet]
  )

  const recentEntries = useMemo(
    () => filteredFiles.filter((file) => recentsByPath.has(toEntryPath(file)) && !favoriteSet.has(toEntryPath(file))),
    [filteredFiles, recentsByPath, favoriteSet]
  )
  const regularEntries = useMemo(
    () => filteredFiles.filter((file) => !favoriteSet.has(toEntryPath(file)) && !recentsByPath.has(toEntryPath(file))),
    [filteredFiles, favoriteSet, recentsByPath]
  )
  const hasFilteredEntries = filteredFiles.length > 0
  const listSubtitle = normalizedSearch
    ? `${filteredFiles.length} of ${files.length} items`
    : `${files.length} items`
  const calendarFolder = useMemo(
    () => (currentPath.startsWith('/memory') ? currentPath : '/memory'),
    [currentPath]
  )
  const requiredCalendarMonths = useMemo(
    () => monthsForLocalCalendarView(calendarAnchor, calendarView),
    [calendarAnchor, calendarView]
  )
  const hasAllRequiredCalendarMonths = useMemo(
    () => requiredCalendarMonths.every((month) => calendarByMonth[month] !== undefined),
    [calendarByMonth, requiredCalendarMonths]
  )
  const userTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Local',
    []
  )

  const breadcrumbs = currentPath
    .split('/')
    .filter(Boolean)
    .map((part, i, arr) => ({
      name: part,
      path: '/' + arr.slice(0, i + 1).join('/'),
    }))

  useEffect(() => {
    const loadFavorites = async () => {
      try {
        const result = await workspaceFavoritesApi.get()
        setFavoritesDoc(result.data)
      } catch {
        // Keep UX functional even when favorites file is unavailable.
      }
    }
    void loadFavorites()
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 30_000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    setCalendarByMonth({})
  }, [calendarFolder])

  useEffect(() => {
    if (viewMode !== 'calendar') return
    const missingMonths = requiredCalendarMonths.filter((month) => calendarByMonth[month] === undefined)
    if (missingMonths.length === 0) return

    let cancelled = false

    const loadCalendar = async () => {
      setCalendarLoading(true)
      try {
        const responses = await Promise.all(
          missingMonths.map((month) => workspaceCalendarApi.get({
            month,
            root: 'memory',
            folder: calendarFolder,
          }))
        )
        if (cancelled) return

        setCalendarByMonth((prev) => {
          const next = { ...prev }
          missingMonths.forEach((month, idx) => {
            next[month] = responses[idx]?.data.days ?? []
          })
          return next
        })
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load calendar')
      } finally {
        if (!cancelled) {
          setCalendarLoading(false)
        }
      }
    }

    void loadCalendar()
    return () => {
      cancelled = true
    }
  }, [calendarByMonth, calendarFolder, requiredCalendarMonths, viewMode])

  // Handle file click - open in drawer
  const handleFileClick = useCallback(async (file: WorkspaceFileDTO) => {
    const entryPath = toEntryPath(file)

    if (file.type === 'folder') {
      const nextPath = file.path === '/' ? `/${file.name}` : `${file.path}/${file.name}`
      setCurrentPath(nextPath)

      // Lazy-load directory contents
      if (!filesByPath[nextPath]) {
        setIsLoading(true)
        setError(null)
        try {
          const result = await workspaceApi.list(nextPath, { sort: sortBy })
          setFilesByPath((prev) => ({ ...prev, [nextPath]: result.data }))
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load directory')
        } finally {
          setIsLoading(false)
        }
      }
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const result = await workspaceApi.get(file.id)
      setSelectedFile(result.data)
      setFileContent(result.data.content)
      try {
        const recents = await workspaceFavoritesApi.touchRecent(entryPath)
        setFavoritesDoc(recents.data)
      } catch {
        // Non-blocking; file opening should still work.
      }
    } catch (err) {
      console.error('Failed to load file:', err)
      setError(err instanceof Error ? err.message : 'Failed to load file')
    } finally {
      setIsLoading(false)
    }
  }, [filesByPath, sortBy])

  // Handle save
  const handleSave = useCallback(async (content: string): Promise<void> => {
    if (!selectedFile) return

    const protectedInfo = PROTECTED_FILES[selectedFile.name]

    // For protected files, trigger Governor confirmation
    if (protectedInfo) {
      return new Promise((resolve, reject) => {
        protectedAction.trigger({
          actionKind: protectedInfo.actionKind,
          actionTitle: `Edit ${protectedInfo.label}`,
          actionDescription: `You are editing "${selectedFile.name}". This is a protected configuration file that affects agent behavior.`,
          onConfirm: async (typedConfirmText) => {
            setIsSaving(true)
            setError(null)

            try {
              await workspaceApi.update(selectedFile.id, {
                content,
                typedConfirmText,
              })
              setSelectedFile((prev) => prev ? { ...prev, content } : null)
              setFileContent(content)
              resolve()
            } catch (err) {
              console.error('Failed to save file:', err)
              if (err instanceof HttpError) {
                setError(err.message)
              }
              reject(err)
            } finally {
              setIsSaving(false)
            }
          },
          onError: (err) => {
            setError(err.message)
            reject(err)
          },
        })
      })
    }

    // For non-protected files, save directly
    setIsSaving(true)
    setError(null)

    try {
      await workspaceApi.update(selectedFile.id, { content })
      setSelectedFile((prev) => prev ? { ...prev, content } : null)
      setFileContent(content)
    } catch (err) {
      console.error('Failed to save file:', err)
      if (err instanceof HttpError) {
        setError(err.message)
      }
      throw err
    } finally {
      setIsSaving(false)
    }
  }, [selectedFile, protectedAction])

  // Render the appropriate editor based on file type
  const renderEditor = () => {
    if (!selectedFile) return null

    const ext = selectedFile.name.split('.').pop()?.toLowerCase()

    const commonProps = {
      value: fileContent,
      onChange: setFileContent,
      onSave: handleSave,
      filePath: selectedFile.path === '/' ? selectedFile.name : `${selectedFile.path}/${selectedFile.name}`,
      isSaving,
      error,
      height: 'calc(100vh - 200px)',
    }

    switch (ext) {
      case 'md':
        return <MarkdownEditor {...commonProps} initialMode="edit" />
      case 'yaml':
      case 'yml':
        return <YamlEditor {...commonProps} />
      case 'json':
        return <JsonEditor {...commonProps} />
      default:
        // For unknown file types, use a basic text display
        return (
          <div>
            <p className="text-sm text-fg-2">
              No editor available for .{ext} files
            </p>
            <pre className="mt-4 p-4 bg-bg-3 rounded text-xs text-fg-1 overflow-auto">
              {fileContent}
            </pre>
          </div>
        )
    }
  }

  const navigateTo = useCallback(async (nextPath: string) => {
    setCurrentPath(nextPath)
    if (!filesByPath[nextPath]) {
      setIsLoading(true)
      setError(null)
      try {
        const result = await workspaceApi.list(nextPath, { sort: sortBy })
        setFilesByPath((prev) => ({ ...prev, [nextPath]: result.data }))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load directory')
      } finally {
        setIsLoading(false)
      }
    }
  }, [filesByPath, sortBy])

  // Handle create file/folder
  const handleCreate = useCallback((type: 'file' | 'folder') => {
    setCreateModalOpen(type)
    setNewName('')
    setError(null)
  }, [])

  const handleCreateSubmit = useCallback(() => {
    if (!createModalOpen || !newName.trim()) return

    const type = createModalOpen

    protectedAction.trigger({
      actionKind: 'action.caution',
      actionTitle: `Create ${type === 'file' ? 'File' : 'Folder'}`,
      actionDescription: `Create "${newName}" in ${currentPath === '/' ? 'workspace root' : currentPath}`,
      onConfirm: async (typedConfirmText) => {
        setIsCreating(true)
        setError(null)

        try {
          const result = await workspaceApi.create({
            path: currentPath,
            name: newName.trim(),
            type,
            typedConfirmText,
          })

          // Add to current path's files
          setFilesByPath((prev) => ({
            ...prev,
            [currentPath]: [...(prev[currentPath] ?? []), result.data],
          }))

          setCreateModalOpen(null)
          setNewName('')
        } catch (err) {
          console.error('Failed to create:', err)
          if (err instanceof HttpError) {
            setError(err.message)
          }
        } finally {
          setIsCreating(false)
        }
      },
      onError: (err) => {
        setError(err.message)
        setIsCreating(false)
      },
    })
  }, [createModalOpen, newName, currentPath, protectedAction])

  // Handle delete file/folder
  const handleDelete = useCallback((file: WorkspaceFileDTO) => {
    // Can't delete protected files
    if (PROTECTED_FILES[file.name]) {
      setError('Protected files cannot be deleted')
      return
    }

    protectedAction.trigger({
      actionKind: 'action.danger',
      actionTitle: `Delete ${file.type === 'folder' ? 'Folder' : 'File'}`,
      actionDescription: `Are you sure you want to delete "${file.name}"?${file.type === 'folder' ? ' This will delete all contents inside.' : ''}`,
      onConfirm: async (typedConfirmText) => {
        setIsDeleting(true)
        setError(null)

        try {
          await workspaceApi.delete(file.id, typedConfirmText)

          // Remove from current path's files
          setFilesByPath((prev) => ({
            ...prev,
            [currentPath]: (prev[currentPath] ?? []).filter((f) => f.id !== file.id),
          }))
        } catch (err) {
          console.error('Failed to delete:', err)
          if (err instanceof HttpError) {
            setError(err.message)
          }
        } finally {
          setIsDeleting(false)
        }
      },
      onError: (err) => {
        setError(err.message)
        setIsDeleting(false)
      },
    })
  }, [currentPath, protectedAction])

  const handleFavoriteToggle = useCallback(async (file: WorkspaceFileDTO) => {
    const path = toEntryPath(file)
    try {
      const result = await workspaceFavoritesApi.update('toggle', path)
      setFavoritesDoc(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update favorites')
    }
  }, [])

  const handleOpenCalendarFile = useCallback(async (file: CalendarDay['files'][number]) => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await workspaceApi.get(file.id)
      setSelectedFile(result.data)
      setFileContent(result.data.content)
      const recents = await workspaceFavoritesApi.touchRecent(file.path)
      setFavoritesDoc(recents.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open file from calendar')
    } finally {
      setIsLoading(false)
    }
  }, [])

  const calendarByDay = useMemo(() => {
    const map = new Map<string, CalendarDay>()
    for (const days of Object.values(calendarByMonth)) {
      for (const day of days) map.set(day.day, day)
    }
    return map
  }, [calendarByMonth])

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
      })
    }

    if (calendarView === 'week') {
      const weekStart = startOfLocalWeek(calendarAnchor)
      const end = addLocalDays(weekStart, 6)
      return `${weekStart.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })} – ${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    }

    if (calendarView === 'month') {
      return calendarAnchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    }

    return calendarAnchor.toLocaleDateString(undefined, { year: 'numeric' })
  }, [calendarAnchor, calendarView])

  const shiftCalendar = useCallback((delta: number) => {
    setCalendarAnchor((prev) => {
      if (calendarView === 'day') return addLocalDays(prev, delta)
      if (calendarView === 'week') return addLocalDays(prev, delta * 7)
      if (calendarView === 'month') return addLocalMonths(prev, delta)
      return addLocalYears(prev, delta)
    })
  }, [calendarView])

  const monthCells = useMemo(() => {
    if (calendarView !== 'month') return []
    return monthGridCellsLocal(new Date(calendarAnchor.getFullYear(), calendarAnchor.getMonth(), 1))
  }, [calendarAnchor, calendarView])

  const weekDays = useMemo(() => {
    if (calendarView !== 'week') return []
    const weekStart = startOfLocalWeek(calendarAnchor)
    return listLocalDaysInRange(weekStart, addLocalDays(weekStart, 6))
  }, [calendarAnchor, calendarView])

  const selectedDayKey = useMemo(
    () => localDayKey(startOfLocalDay(calendarAnchor)),
    [calendarAnchor]
  )
  const selectedDay = useMemo(
    () => (calendarView === 'day' ? calendarByDay.get(selectedDayKey) : undefined),
    [calendarByDay, calendarView, selectedDayKey]
  )
  const dayViewDate = useMemo(
    () => (calendarView === 'day' ? startOfLocalDay(calendarAnchor) : null),
    [calendarAnchor, calendarView]
  )

  const calendarFileById = useMemo(() => {
    const map = new Map<string, CalendarDay['files'][number]>()
    for (const day of calendarByDay.values()) {
      for (const file of day.files) {
        map.set(file.id, file)
      }
    }
    return map
  }, [calendarByDay])

  const openCalendarFileById = useCallback((fileId: string) => {
    const file = calendarFileById.get(fileId)
    if (file) {
      void handleOpenCalendarFile(file)
    }
  }, [calendarFileById, handleOpenCalendarFile])

  const timelineEventsByDayKey = useMemo(() => {
    const map = new Map<string, LaidOutTimelineEvent[]>()
    for (const [dayKey, dayData] of calendarByDay.entries()) {
      if (dayData.files.length === 0) {
        map.set(dayKey, [])
        continue
      }
      const dayDate = dayFromDayKey(dayKey)
      const events = buildTimelineEventsForDay(dayDate, dayData.files)
      map.set(dayKey, layoutTimelineEvents(events, timelineEventDurationForCount(events.length)))
    }
    return map
  }, [calendarByDay])

  const yearBuckets = useMemo(() => {
    if (calendarView !== 'year') return []
    const year = calendarAnchor.getFullYear()

    return Array.from({ length: 12 }, (_, monthIndex) => {
      const month = new Date(year, monthIndex, 1)
      const key = monthKeyFromLocalDate(month)
      const days = calendarByMonth[key] ?? []
      const totalFiles = days.reduce((sum, day) => sum + day.count, 0)
      const firstFile = days.find((day) => day.files.length > 0)?.files[0] ?? null

      return {
        key,
        monthIndex,
        monthLabel: month.toLocaleDateString(undefined, { month: 'short' }),
        totalFiles,
        firstFile,
      }
    })
  }, [calendarAnchor, calendarByMonth, calendarView])

  const hasEntriesInActiveView = useMemo(() => {
    if (calendarView === 'day') {
      return (selectedDay?.count ?? 0) > 0
    }
    if (calendarView === 'week') {
      return weekDays.some((day) => (calendarByDay.get(localDayKey(day))?.count ?? 0) > 0)
    }
    if (calendarView === 'month') {
      return monthCells.some((cell) => (cell.date ? (calendarByDay.get(localDayKey(cell.date))?.count ?? 0) > 0 : false))
    }
    return yearBuckets.some((bucket) => bucket.totalFiles > 0)
  }, [calendarByDay, calendarView, monthCells, selectedDay, weekDays, yearBuckets])

  return (
    <>
      <div className="w-full space-y-4">
        <PageHeader
          title="Workspace"
          subtitle={listSubtitle}
          actions={
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-fg-3" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter files..."
                  className="w-[220px] pl-7 pr-2 py-1.5 text-xs bg-bg-3 border border-bd-0 rounded-[var(--radius-md)] text-fg-1 placeholder:text-fg-3 focus:outline-none focus:border-bd-1"
                />
              </div>

              <SelectDropdown
                value={sortBy}
                onChange={(nextValue) => setSortBy(nextValue as WorkspaceSort)}
                ariaLabel="Workspace sort"
                tone="toolbar"
                size="sm"
                options={[
                  { value: 'name', label: 'Sort: Name', textValue: 'sort name' },
                  { value: 'recentlyEdited', label: 'Sort: Recently Edited', textValue: 'sort recently edited' },
                  { value: 'newestCreated', label: 'Sort: Newest Created', textValue: 'sort newest created' },
                  { value: 'oldestCreated', label: 'Sort: Oldest Created', textValue: 'sort oldest created' },
                ]}
              />

              <SegmentedToggle
                value={viewMode}
                onChange={setViewMode}
                tone="neutral"
                ariaLabel="Workspace view mode"
                items={[
                  {
                    value: 'list',
                    label: (
                      <>
                        <List className="w-3.5 h-3.5" />
                        List
                      </>
                    ),
                  },
                  {
                    value: 'calendar',
                    label: (
                      <>
                        <CalendarDays className="w-3.5 h-3.5" />
                        Calendar
                      </>
                    ),
                  },
                ]}
              />

              <DropdownMenu
                trigger={
                  <>
                    <Plus className="w-3.5 h-3.5" />
                    New
                  </>
                }
                ariaLabel="Create workspace item"
                size="sm"
                align="end"
                menuWidth={170}
                className="bg-bg-2"
                items={[
                  {
                    id: 'file',
                    label: 'New File',
                    icon: <FilePlus className="w-4 h-4" />,
                  },
                  {
                    id: 'folder',
                    label: 'New Folder',
                    icon: <FolderPlus className="w-4 h-4" />,
                  },
                ]}
                onSelect={(itemId) => handleCreate(itemId)}
              />
            </div>
          }
        />

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 text-sm">
          <button
            onClick={() => navigateTo('/')}
            className={cn(
              'px-2 py-1 rounded hover:bg-bg-3 transition-colors',
              currentPath === '/' ? 'text-fg-0' : 'text-fg-2'
            )}
          >
            workspace
          </button>
          {breadcrumbs.map((crumb) => (
            <div key={crumb.path} className="flex items-center gap-1">
              <ChevronRight className="w-3.5 h-3.5 text-fg-3" />
              <button
                onClick={() => navigateTo(crumb.path)}
                className="px-2 py-1 rounded hover:bg-bg-3 transition-colors text-fg-1"
              >
                {crumb.name}
              </button>
            </div>
          ))}
        </div>

        {/* File List / Calendar */}
        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
          {viewMode === 'calendar' ? (
            <div className="p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CalendarDays className="w-4 h-4 text-fg-1" />
                  <h2 className="text-sm font-medium text-fg-0">Workspace Calendar</h2>
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
                    onClick={() => setCalendarAnchor(startOfLocalDay(new Date()))}
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

              <div className="text-xs text-fg-2">
                {calendarLabel} ({userTimeZone}) {calendarView !== 'year' ? `• Now: ${nowLocalLabel}` : ''}
              </div>
              <div className="text-[11px] text-fg-3">Scope: {calendarFolder}</div>

              {!hasEntriesInActiveView && hasAllRequiredCalendarMonths && (
                <div className="text-xs text-fg-3">No YYYY-MM-DD.md files found for this range.</div>
              )}

              {calendarLoading && !hasAllRequiredCalendarMonths ? (
                <div className="flex items-center justify-center py-8 text-fg-2 text-sm">
                  <LoadingSpinner size="md" className="mr-2" />
                  Loading calendar…
                </div>
              ) : calendarView === 'year' ? (
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
                  {yearBuckets.map((bucket) => (
                    <button
                      key={bucket.key}
                      onClick={() => {
                        setCalendarView('month')
                        setCalendarAnchor(new Date(calendarAnchor.getFullYear(), bucket.monthIndex, 1))
                      }}
                      className={cn(
                        'rounded-[var(--radius-md)] p-3 text-left transition-colors',
                        bucket.totalFiles > 0
                          ? 'bg-status-info/10 hover:bg-status-info/20'
                          : 'bg-bg-3/40 hover:bg-bg-3/60'
                      )}
                    >
                      <div className="text-xs text-fg-1">{bucket.monthLabel}</div>
                      <div className="mt-1 text-lg font-semibold text-fg-0">{bucket.totalFiles}</div>
                      <div className="text-[11px] text-fg-2">dated files</div>
                      <div className="mt-2 text-[11px] text-fg-2 truncate">
                        {bucket.firstFile ? bucket.firstFile.name : 'No dated files'}
                      </div>
                    </button>
                  ))}
                </div>
              ) : calendarView === 'month' ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-7 text-xs text-fg-2 bg-bg-3/50 rounded-[var(--radius-md)] overflow-hidden">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
                      <div key={label} className="py-2 text-center">{label}</div>
                    ))}
                  </div>

                  <div className="grid grid-cols-7 gap-1">
                    {monthCells.map((cell, idx) => {
                      if (!cell.date) {
                        return <div key={`empty-${idx}`} className="h-24 rounded-[var(--radius-md)] bg-bg-3/20" />
                      }

                      const key = localDayKey(cell.date)
                      const dayData = calendarByDay.get(key)
                      return (
                        <button
                          key={key}
                          onClick={() => {
                            setCalendarAnchor(startOfLocalDay(cell.date!))
                            setCalendarView('day')
                          }}
                          className={cn(
                            'h-24 rounded-[var(--radius-md)] p-2 text-left transition-colors',
                            dayData && dayData.count > 0
                              ? 'bg-status-info/10 hover:bg-status-info/20'
                              : 'bg-bg-3/[0.35] hover:bg-bg-3/[0.55]'
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-fg-1">{cell.date.getDate()}</span>
                            <span className="text-[11px] text-fg-2">{dayData?.count ?? 0}</span>
                          </div>
                          <div className="mt-2 text-[11px] text-fg-2">files</div>
                          <div className="mt-1 text-[11px] text-fg-2 truncate">{dayData?.files[0]?.name ?? '—'}</div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : calendarView === 'week' ? (
                <div
                  className="rounded-[var(--radius-md)] overflow-y-auto overflow-x-hidden border border-bd-0"
                  style={{
                    background: 'linear-gradient(180deg, rgb(28 28 28 / 0.95) 0%, rgb(12 12 12 / 0.92) 100%)',
                  }}
                >
                  <div style={{ minWidth: '100%' }}>
                    <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))]">
                      <div className="h-12" />
                      {weekDays.map((day) => {
                        const dayKey = localDayKey(day)
                        const dayData = calendarByDay.get(dayKey)
                        return (
                          <button
                            key={dayKey}
                            onClick={() => {
                              setCalendarAnchor(startOfLocalDay(day))
                              setCalendarView('day')
                            }}
                            className="h-12 px-2 text-left border-l border-bd-0 hover:bg-bg-3 transition-colors"
                            style={{
                              background: 'linear-gradient(180deg, rgb(38 38 38 / 0.9) 0%, rgb(23 23 23 / 0.85) 100%)',
                            }}
                          >
                            <div className="text-xs text-fg-1">{day.toLocaleDateString(undefined, { weekday: 'short' })}</div>
                            <div className="text-[11px] text-fg-2">{day.getDate()} • {dayData?.count ?? 0}</div>
                          </button>
                        )
                      })}
                    </div>

                    <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))]">
                      <div
                        className="relative border-r border-bd-0"
                        style={{
                          height: `${TIMELINE_HEIGHT_PX}px`,
                          background: 'linear-gradient(180deg, rgb(30 30 30 / 0.9) 0%, rgb(20 20 20 / 0.86) 100%)',
                        }}
                      >
                        {Array.from({ length: 24 }, (_, hour) => (
                          <div key={hour} className="absolute left-0 right-0 text-[10px] text-fg-3 px-1" style={{ top: `${(hour / 24) * 100}%` }}>
                            {String(hour).padStart(2, '0')}:00
                          </div>
                        ))}
                      </div>

                      {weekDays.map((day) => {
                        const dayKey = localDayKey(day)
                        const events = timelineEventsByDayKey.get(dayKey) ?? []
                        const renderData = buildTimelineRenderData(events, TIMELINE_WEEK_MAX_COLUMNS)
                        const isToday = isSameLocalDay(day, new Date(nowMs))
                        const nowMinute = new Date(nowMs).getHours() * 60 + new Date(nowMs).getMinutes()

                        return (
                          <div
                            key={dayKey}
                            className="relative border-l border-bd-0"
                            style={{
                              height: `${TIMELINE_HEIGHT_PX}px`,
                              background: 'linear-gradient(180deg, rgb(22 22 22 / 0.9) 0%, rgb(16 16 16 / 0.82) 100%)',
                            }}
                          >
                            {Array.from({ length: 24 }, (_, hour) => (
                              <div
                                key={hour}
                                className="absolute left-0 right-0 h-px"
                                style={{
                                  top: `${(hour / 24) * 100}%`,
                                  backgroundColor: 'rgb(64 64 64 / 0.5)',
                                }}
                              />
                            ))}
                            {isToday && (
                              <div
                                className="absolute left-0 right-0 h-[2px] z-20"
                                style={{
                                  top: `${(nowMinute / 1440) * 100}%`,
                                  backgroundColor: 'rgb(220 38 38 / 0.85)',
                                }}
                              />
                            )}
                            {renderData.visibleEvents.map((event) => {
                              const compact = event.heightPercent < 2.4 || event.laneCount > 2
                              const placement = timelineColumnInsets(event, TIMELINE_WEEK_MAX_COLUMNS, 4)
                              return (
                                <button
                                  key={event.key}
                                  onClick={() => {
                                    void handleOpenCalendarFile(event.file)
                                  }}
                                  className="absolute relative rounded-[var(--radius-md)] border text-left z-10 overflow-hidden hover:brightness-110 transition-[filter]"
                                  style={{
                                    ...TIMELINE_EVENT_CHROME,
                                    top: `${event.topPercent}%`,
                                    height: `${event.heightPercent}%`,
                                    left: placement.left,
                                    right: placement.right,
                                  }}
                                  title={`${event.file.name} • ${formatMinuteLabel(day, event.minuteOfDay)}`}
                                >
                                  <span
                                    className="absolute left-0 top-0 bottom-0 w-1"
                                    style={{ backgroundColor: 'rgb(96 165 250 / 0.88)' }}
                                  />
                                  <div className={cn('h-full pl-2 pr-1.5 py-1', compact && 'py-0.5')}>
                                    <div className={cn('truncate text-fg-0', compact ? 'text-[10px] leading-tight font-medium' : 'text-[11px] leading-tight font-semibold')}>
                                      {event.file.name}
                                    </div>
                                    {!compact && (
                                      <div className="text-[10px] text-fg-1 leading-tight mt-0.5 truncate">
                                        {formatMinuteLabel(day, event.minuteOfDay)} • {event.file.path}
                                      </div>
                                    )}
                                  </div>
                                </button>
                              )
                            })}
                            {renderData.overflowBadges.map((badge) => (
                              <button
                                key={badge.key}
                                onClick={() => openCalendarFileById(badge.primaryFileId)}
                                className="absolute right-1 z-20 px-1.5 py-0.5 text-[10px] font-medium text-fg-1 border rounded-[var(--radius-sm)] hover:text-fg-0"
                                style={{
                                  ...TIMELINE_OVERFLOW_CHROME,
                                  top: `calc(${badge.topPercent}% + 2px)`,
                                }}
                                title={`${badge.hiddenCount} additional overlapping files`}
                              >
                                +{badge.hiddenCount} more
                              </button>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  className="rounded-[var(--radius-md)] overflow-y-auto overflow-x-hidden border border-bd-0"
                  style={{
                    background: 'linear-gradient(180deg, rgb(28 28 28 / 0.95) 0%, rgb(12 12 12 / 0.92) 100%)',
                  }}
                >
                  {dayViewDate && (
                    <div className="grid grid-cols-[60px_1fr]" style={{ minWidth: '100%' }}>
                      <div
                        className="relative border-r border-bd-0"
                        style={{
                          height: `${TIMELINE_HEIGHT_PX}px`,
                          background: 'linear-gradient(180deg, rgb(30 30 30 / 0.9) 0%, rgb(20 20 20 / 0.86) 100%)',
                        }}
                      >
                        {Array.from({ length: 24 }, (_, hour) => (
                          <div key={hour} className="absolute left-0 right-0 text-[10px] text-fg-3 px-1" style={{ top: `${(hour / 24) * 100}%` }}>
                            {String(hour).padStart(2, '0')}:00
                          </div>
                        ))}
                      </div>
                      <div
                        className="relative"
                        style={{
                          height: `${TIMELINE_HEIGHT_PX}px`,
                          background: 'linear-gradient(180deg, rgb(22 22 22 / 0.92) 0%, rgb(16 16 16 / 0.82) 100%)',
                        }}
                      >
                        {Array.from({ length: 24 }, (_, hour) => (
                          <div
                            key={hour}
                            className="absolute left-0 right-0 h-px"
                            style={{
                              top: `${(hour / 24) * 100}%`,
                              backgroundColor: 'rgb(64 64 64 / 0.52)',
                            }}
                          />
                        ))}
                        {isSameLocalDay(dayViewDate, new Date(nowMs)) && (
                          <div
                            className="absolute left-0 right-0 h-[2px] z-20"
                            style={{
                              top: `${((new Date(nowMs).getHours() * 60 + new Date(nowMs).getMinutes()) / 1440) * 100}%`,
                              backgroundColor: 'rgb(220 38 38 / 0.85)',
                            }}
                          />
                        )}
                        {(() => {
                          const renderData = buildTimelineRenderData(
                            timelineEventsByDayKey.get(localDayKey(dayViewDate)) ?? [],
                            TIMELINE_DAY_MAX_COLUMNS
                          )

                          return (
                            <>
                              {renderData.visibleEvents.map((event) => {
                                const compact = event.heightPercent < 2.2 || event.laneCount > 3
                                const placement = timelineColumnInsets(event, TIMELINE_DAY_MAX_COLUMNS, 6)
                                return (
                                  <button
                                    key={event.key}
                                    onClick={() => {
                                      void handleOpenCalendarFile(event.file)
                                    }}
                                    className="absolute relative rounded-[var(--radius-md)] border text-left z-10 overflow-hidden hover:brightness-110 transition-[filter]"
                                    style={{
                                      ...TIMELINE_EVENT_CHROME,
                                      top: `${event.topPercent}%`,
                                      height: `${event.heightPercent}%`,
                                      left: placement.left,
                                      right: placement.right,
                                    }}
                                    title={`${event.file.name} • ${formatMinuteLabel(dayViewDate, event.minuteOfDay)}`}
                                  >
                                    <span
                                      className="absolute left-0 top-0 bottom-0 w-1"
                                      style={{ backgroundColor: 'rgb(96 165 250 / 0.9)' }}
                                    />
                                    <div className={cn('h-full pl-2.5 pr-2 py-1.5', compact && 'py-0.5')}>
                                      <div className={cn('truncate text-fg-0', compact ? 'text-[11px] leading-tight font-medium' : 'text-xs leading-tight font-semibold')}>
                                        {event.file.name}
                                      </div>
                                      {!compact && (
                                        <div className="text-[11px] text-fg-1 leading-tight mt-0.5 truncate">
                                          {formatMinuteLabel(dayViewDate, event.minuteOfDay)} • {event.file.path}
                                        </div>
                                      )}
                                    </div>
                                  </button>
                                )
                              })}
                              {renderData.overflowBadges.map((badge) => (
                                <button
                                  key={badge.key}
                                  onClick={() => openCalendarFileById(badge.primaryFileId)}
                                  className="absolute right-2 z-20 px-2 py-0.5 text-[11px] font-medium text-fg-1 border rounded-[var(--radius-sm)] hover:text-fg-0"
                                  style={{
                                    ...TIMELINE_OVERFLOW_CHROME,
                                    top: `calc(${badge.topPercent}% + 2px)`,
                                  }}
                                  title={`${badge.hiddenCount} additional overlapping files`}
                                >
                                  +{badge.hiddenCount} more
                                </button>
                              ))}
                            </>
                          )
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : hasFilteredEntries ? (
            <div>
              <div className="grid grid-cols-[1fr_140px_140px_110px] gap-3 px-3 py-2 border-b border-bd-0 text-[11px] text-fg-2">
                <span>Name</span>
                <span>Created</span>
                <span>Last Edited</span>
                <span className="text-right">Size</span>
              </div>

              {favoriteEntries.length > 0 && (
                <SectionHeader title="Favorites" />
              )}
              <div className="divide-y divide-bd-0">
                {favoriteEntries.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    isProtected={!!PROTECTED_FILES[file.name]}
                    isFavorite
                    onToggleFavorite={() => handleFavoriteToggle(file)}
                    onClick={() => handleFileClick(file)}
                    onDelete={() => handleDelete(file)}
                    isDeleting={isDeleting}
                  />
                ))}
              </div>

              {recentEntries.length > 0 && (
                <SectionHeader title="Recent" />
              )}
              <div className="divide-y divide-bd-0">
                {recentEntries.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    isProtected={!!PROTECTED_FILES[file.name]}
                    isFavorite={favoriteSet.has(toEntryPath(file))}
                    onToggleFavorite={() => handleFavoriteToggle(file)}
                    onClick={() => handleFileClick(file)}
                    onDelete={() => handleDelete(file)}
                    isDeleting={isDeleting}
                  />
                ))}
              </div>

              {regularEntries.length > 0 && (favoriteEntries.length > 0 || recentEntries.length > 0) && (
                <SectionHeader title="All Files" />
              )}
              <div className="divide-y divide-bd-0">
                {regularEntries.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    isProtected={!!PROTECTED_FILES[file.name]}
                    isFavorite={favoriteSet.has(toEntryPath(file))}
                    onToggleFavorite={() => handleFavoriteToggle(file)}
                    onClick={() => handleFileClick(file)}
                    onDelete={() => handleDelete(file)}
                    isDeleting={isDeleting}
                  />
                ))}
              </div>
            </div>
          ) : files.length > 0 && normalizedSearch ? (
            <EmptyState
              icon={<Search className="w-8 h-8" />}
              title="No matching files"
              description={`No files match "${searchQuery.trim()}" in this folder.`}
            />
          ) : (
            <EmptyState
              icon={<FolderTree className="w-8 h-8" />}
              title="Empty folder"
              description="No files in this directory"
            />
          )}
        </div>
      </div>

      {/* Editor Drawer */}
      <RightDrawer
        open={!!selectedFile}
        onClose={() => {
          setSelectedFile(null)
          setError(null)
        }}
        title={selectedFile?.name ?? ''}
        description={
          selectedFile && PROTECTED_FILES[selectedFile.name]
            ? 'Protected configuration file'
            : undefined
        }
        width="xl"
      >
        {isLoading ? (
          <LoadingState />
        ) : (
          renderEditor()
        )}
      </RightDrawer>

      {/* Create Modal */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-bg-2 border border-bd-1 rounded-[var(--radius-lg)] p-6 w-full max-w-md mx-4 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-fg-0">
                New {createModalOpen === 'file' ? 'File' : 'Folder'}
              </h2>
              <button
                onClick={() => setCreateModalOpen(null)}
                className="p-1 hover:bg-bg-3 rounded"
              >
                <X className="w-4 h-4 text-fg-2" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-fg-2 mb-1.5">
                  Name
                </label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder={createModalOpen === 'file' ? 'example.md' : 'new-folder'}
                  className="w-full px-3 py-2 text-sm bg-bg-3 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-status-info/50"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newName.trim()) {
                      handleCreateSubmit()
                    }
                    if (e.key === 'Escape') {
                      setCreateModalOpen(null)
                    }
                  }}
                />
              </div>

              <div className="text-xs text-fg-3">
                Creating in: <span className="font-mono text-fg-2">{currentPath}</span>
              </div>

              {error && (
                <div className="p-2 text-xs text-status-danger bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)]">
                  {error}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => setCreateModalOpen(null)}
                  variant="secondary"
                  size="md"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateSubmit}
                  disabled={!newName.trim() || isCreating}
                  variant="primary"
                  size="md"
                >
                  {isCreating && <LoadingSpinner size="sm" />}
                  Create
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      <TypedConfirmModal
        isOpen={protectedAction.state.isOpen}
        onClose={protectedAction.cancel}
        onConfirm={protectedAction.confirm}
        actionTitle={protectedAction.state.actionTitle}
        actionDescription={protectedAction.state.actionDescription}
        confirmMode={protectedAction.confirmMode}
        riskLevel={protectedAction.riskLevel}
        workOrderCode={protectedAction.state.workOrderCode}
        entityName={protectedAction.state.entityName}
        isLoading={protectedAction.state.isLoading}
      />
    </>
  )
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function FileRow({
  file,
  isProtected,
  isFavorite,
  onToggleFavorite,
  onClick,
  onDelete,
  isDeleting,
}: {
  file: WorkspaceFileDTO
  isProtected: boolean
  isFavorite: boolean
  onToggleFavorite: () => void
  onClick: () => void
  onDelete: () => void
  isDeleting: boolean
}) {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const Icon = file.type === 'folder' ? Folder : getFileIcon(ext)

  return (
    <div className="group">
      <div className="grid grid-cols-[1fr_140px_140px_110px] gap-3 p-3 hover:bg-bg-3/50 transition-colors items-center">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleFavorite()
            }}
            className="p-1 rounded hover:bg-bg-2"
            title={isFavorite ? 'Remove favorite' : 'Add favorite'}
          >
            <Star className={cn('w-3.5 h-3.5', isFavorite ? 'text-status-warning fill-status-warning' : 'text-fg-3')} />
          </button>
          <button
            onClick={onClick}
            className="flex-1 flex items-center gap-2 text-left min-w-0"
          >
            <Icon className={cn(
              'w-4 h-4 shrink-0',
              file.type === 'folder' ? 'text-status-warning' : 'text-fg-2'
            )} />
            <span className="truncate text-sm text-fg-0">{file.name}</span>
            {isProtected && (
              <span title="Protected file">
                <Shield className="w-3.5 h-3.5 text-status-warning shrink-0" />
              </span>
            )}
            {file.type === 'folder' && (
              <ChevronRight className="w-4 h-4 text-fg-3 shrink-0" />
            )}
          </button>
        </div>

        <span className="text-xs text-fg-2">{file.createdAt ? formatDateTime(file.createdAt) : '—'}</span>
        <span className="text-xs text-fg-2">{formatDateTime(file.lastEditedAt)}</span>
        <div className="flex items-center justify-end gap-2">
          {file.size ? <span className="text-xs text-fg-2 font-mono">{formatFileSize(file.size)}</span> : <span className="text-xs text-fg-3">—</span>}
          {!isProtected && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDelete()
              }}
              disabled={isDeleting}
              className="p-1.5 opacity-0 group-hover:opacity-100 hover:bg-status-danger/10 rounded transition-all"
              title="Delete"
            >
              <Trash2 className="w-3.5 h-3.5 text-status-danger" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="px-3 py-2 bg-bg-3/60 border-y border-bd-0 text-[11px] uppercase tracking-wide text-fg-2">
      {title}
    </div>
  )
}

function getFileIcon(ext?: string) {
  switch (ext) {
    case 'md':
      return FileText
    case 'yaml':
    case 'yml':
    case 'json':
      return FileCode
    default:
      return FileText
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDateTime(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
