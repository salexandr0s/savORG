import { NextResponse } from 'next/server'
import { runSyncJob } from '@/lib/cron/sync-job'
import type { SyncRunSource } from '@/lib/sync-state'

let inFlight: Promise<Awaited<ReturnType<typeof runSyncJob>>> | null = null

function parseSource(input: unknown): SyncRunSource {
  if (input === 'boot' || input === 'manual' || input === 'poll') return input
  return 'manual'
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { source?: unknown } | null
  const source = parseSource(body?.source)

  if (!inFlight) {
    inFlight = runSyncJob(source).finally(() => {
      inFlight = null
    })
  }

  const result = await inFlight

  const statusCode = result.agents.success || result.sessions.success ? 200 : 502

  return NextResponse.json(result, { status: statusCode })
}
