import 'server-only'

export type SyncRunSource = 'boot' | 'manual' | 'poll'

export interface SyncStepStatus {
  success: boolean
  count: number
  error?: string
}

export interface SyncRunStatus {
  timestamp: string
  source: SyncRunSource
  agents: SyncStepStatus
  sessions: SyncStepStatus
}

export interface SyncState {
  bootSync: SyncRunStatus | null
  lastSync: SyncRunStatus | null
}

type GlobalSync = typeof globalThis & {
  __clawcontrol_sync_state?: SyncState
}

function getStateRef(): SyncState {
  const g = globalThis as GlobalSync
  if (!g.__clawcontrol_sync_state) {
    g.__clawcontrol_sync_state = {
      bootSync: null,
      lastSync: null,
    }
  }
  return g.__clawcontrol_sync_state
}

export function getSyncState(): SyncState {
  const state = getStateRef()
  return {
    bootSync: state.bootSync,
    lastSync: state.lastSync,
  }
}

export function setBootSync(result: SyncRunStatus): void {
  const state = getStateRef()
  state.bootSync = result
  state.lastSync = result
}

export function setLastSync(result: SyncRunStatus): void {
  const state = getStateRef()
  state.lastSync = result
}
