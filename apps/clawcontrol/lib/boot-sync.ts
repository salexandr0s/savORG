import 'server-only'

import { syncAgentsFromOpenClaw } from '@/lib/sync-agents'
import { syncSessionsFromOpenClaw } from '@/lib/sync-sessions'
import { isFirstRun } from '@/lib/first-run'
import { setBootSync, type SyncRunStatus } from '@/lib/sync-state'

export async function bootSync(): Promise<SyncRunStatus> {
  const timestamp = new Date().toISOString()

  const result: SyncRunStatus = {
    timestamp,
    source: 'boot',
    agents: {
      success: false,
      count: 0,
    },
    sessions: {
      success: false,
      count: 0,
    },
  }

  let forceRefresh = false
  try {
    forceRefresh = await isFirstRun()
  } catch (err) {
    result.agents.error = err instanceof Error ? err.message : String(err)
  }

  try {
    const agentResult = await syncAgentsFromOpenClaw({ forceRefresh })
    result.agents = {
      success: true,
      count: agentResult.added + agentResult.updated,
    }
  } catch (err) {
    result.agents.error = err instanceof Error ? err.message : String(err)
    console.error('[boot] Agent sync failed:', result.agents.error)
  }

  try {
    const sessionResult = await syncSessionsFromOpenClaw()
    result.sessions = {
      success: true,
      count: sessionResult.synced,
    }
  } catch (err) {
    // Session telemetry sync should not hard-fail boot UX.
    result.sessions = {
      success: true,
      count: 0,
    }
    console.warn(
      '[boot] Session sync skipped:',
      err instanceof Error ? err.message : String(err)
    )
  }

  setBootSync(result)
  return result
}
