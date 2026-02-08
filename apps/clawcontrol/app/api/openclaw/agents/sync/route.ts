import { NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { syncAgentsFromOpenClaw } from '@/lib/sync-agents'

/**
 * POST /api/openclaw/agents/sync
 *
 * Sync OpenClaw agents into ClawControl DB.
 * Canonical flow is CLI-first (`openclaw config get agents.list --json`) with
 * filesystem/config fallback.
 */
export async function POST() {
  try {
    const repos = getRepos()
    const stats = await syncAgentsFromOpenClaw({ forceRefresh: true })
    const data = await repos.agents.list({})

    return NextResponse.json({
      data,
      stats,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: 'OPENCLAW_SYNC_FAILED',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 502 }
    )
  }
}
