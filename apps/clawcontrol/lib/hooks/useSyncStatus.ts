'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { apiGet, apiPost } from '@/lib/http'

export interface SyncStepStatus {
  success: boolean
  count: number
  error?: string
}

export interface SyncRunStatus {
  timestamp: string
  source: 'boot' | 'manual' | 'poll'
  agents: SyncStepStatus
  sessions: SyncStepStatus
}

export interface SyncStatusResponse {
  bootSync: SyncRunStatus | null
  lastSync: SyncRunStatus | null
  gatewayConnected: boolean
  stale: boolean
  staleMs: number | null
}

interface UseSyncStatusOptions {
  polling?: boolean
}

const STATUS_POLL_INTERVAL_MS = 60_000
const SYNC_POLL_INTERVAL_MS = 5 * 60_000

async function fetchSyncStatus(): Promise<SyncStatusResponse | null> {
  try {
    return await apiGet<SyncStatusResponse>('/api/sync/status')
  } catch {
    return null
  }
}

async function runSync(): Promise<SyncRunStatus | null> {
  return runSyncWithSource('manual')
}

async function runSyncWithSource(source: 'manual' | 'poll'): Promise<SyncRunStatus | null> {
  try {
    return await apiPost<SyncRunStatus, { source: 'manual' | 'poll' }>(
      '/api/sync/run',
      { source }
    )
  } catch {
    return null
  }
}

export function useSyncStatus(options: UseSyncStatusOptions = {}) {
  const polling = options.polling ?? true
  const [status, setStatus] = useState<SyncStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const refresh = useCallback(async () => {
    const current = await fetchSyncStatus()
    if (current) setStatus(current)
    setLoading(false)
  }, [])

  const triggerSync = useCallback(async (source: 'manual' | 'poll' = 'manual'): Promise<boolean> => {
    setSyncing(true)
    try {
      const synced = source === 'poll'
        ? await runSyncWithSource('poll')
        : await runSync()
      if (!synced) return false
      await refresh()
      return true
    } finally {
      setSyncing(false)
    }
  }, [refresh])

  const refreshRef = useRef(refresh)
  const triggerSyncRef = useRef(triggerSync)

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  useEffect(() => {
    triggerSyncRef.current = triggerSync
  }, [triggerSync])

  useEffect(() => {
    void refreshRef.current()
  }, [])

  useEffect(() => {
    if (!polling) return

    const statusInterval = window.setInterval(() => {
      void refreshRef.current()
    }, STATUS_POLL_INTERVAL_MS)

    const syncInterval = window.setInterval(() => {
      void triggerSyncRef.current('poll')
    }, SYNC_POLL_INTERVAL_MS)

    return () => {
      window.clearInterval(statusInterval)
      window.clearInterval(syncInterval)
    }
  }, [polling])

  return {
    status,
    loading,
    syncing,
    refresh,
    triggerSync,
  }
}
