import 'server-only'

import { syncAgentSessions } from '@/lib/openclaw/sessions'

export async function syncSessionsFromOpenClaw(): Promise<{ seen: number; synced: number }> {
  const result = await syncAgentSessions()
  return {
    seen: result.seen,
    synced: result.upserted,
  }
}
