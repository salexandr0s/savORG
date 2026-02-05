import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import type { AgentFilters } from '@/lib/repo'
import { isFirstRun } from '@/lib/first-run'
import { syncAgentsFromOpenClaw } from '@/lib/sync-agents'

/**
 * GET /api/agents
 *
 * List agents with optional filters
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  const filters: AgentFilters = {}

  // Station filter (can be comma-separated)
  const station = searchParams.get('station')
  if (station) {
    filters.station = station.includes(',') ? station.split(',') : station
  }

  // Status filter (can be comma-separated)
  const status = searchParams.get('status')
  if (status) {
    filters.status = status.includes(',') ? status.split(',') : status
  }

  try {
    const repos = getRepos()
    let data = await repos.agents.list(filters)

    // First-run fallback: if no filters and DB is empty, attempt OpenClaw sync.
    const hasFilters = Boolean(station || status)
    if (!hasFilters && data.length === 0) {
      const firstRun = await isFirstRun()
      if (firstRun) {
        try {
          await syncAgentsFromOpenClaw({ forceRefresh: true })
          data = await repos.agents.list(filters)
        } catch (syncErr) {
          console.warn(
            '[api/agents] OpenClaw first-run sync failed:',
            syncErr instanceof Error ? syncErr.message : String(syncErr)
          )
        }
      }
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/agents] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch agents' },
      { status: 500 }
    )
  }
}
