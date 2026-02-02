import { NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { runCommandJson } from '@savorg/adapters-openclaw'

type OpenClawAgentConfig = {
  id: string
  name?: string
  identity?: {
    name?: string
    emoji?: string
  }
}

function inferRoleAndStation(agentId: string): { role: string; station: string } {
  // SavorgCompany defaults
  switch (agentId) {
    case 'main':
      return { role: 'ceo', station: 'ops' }
    case 'savorgplan':
      return { role: 'plan', station: 'spec' }
    case 'savorgplanreview':
      return { role: 'planreview', station: 'spec' }
    case 'savorgbuild':
      return { role: 'build', station: 'build' }
    case 'savorgbuildreview':
      return { role: 'buildreview', station: 'qa' }
    case 'savorgops':
      return { role: 'ops', station: 'ops' }
    case 'savorgsecurity':
      return { role: 'security', station: 'ops' }
    default:
      return { role: 'agent', station: 'ops' }
  }
}

function inferDisplayName(agentId: string, cfg: OpenClawAgentConfig): string {
  return cfg.name || cfg.identity?.name || agentId
}

function inferSessionKey(agentId: string): string {
  // Matches OpenClaw session key convention for agent stores.
  // main is special because it's typically agent:main:main
  if (agentId === 'main') return 'agent:main:main'
  return `agent:${agentId}:${agentId}`
}

/**
 * POST /api/openclaw/agents/sync
 *
 * Pull OpenClaw agent definitions from local OpenClaw config and upsert them
 * into Mission Control's DB.
 */
export async function POST() {
  const repos = getRepos()

  // Pull from OpenClaw local config (authoritative list of agent ids)
  const res = await runCommandJson<OpenClawAgentConfig[]>('config.agents.list.json')

  if (res.error || !res.data) {
    return NextResponse.json(
      {
        error: 'OPENCLAW_SYNC_FAILED',
        detail: res.error || 'Unknown error',
      },
      { status: 502 }
    )
  }

  const agents = res.data

  let created = 0
  let updated = 0

  for (const a of agents) {
    if (!a?.id) continue

    const { role, station } = inferRoleAndStation(a.id)
    const name = inferDisplayName(a.id, a)
    const sessionKey = inferSessionKey(a.id)

    // Upsert by sessionKey (unique)
    const existing = await repos.agents.getBySessionKey(sessionKey)

    if (!existing) {
      await repos.agents.create({
        name,
        role,
        station: station as never,
        sessionKey,
        capabilities: { [station]: true },
        wipLimit: a.id === 'savorgbuild' ? 3 : 2,
      })
      created++
    } else {
      await repos.agents.update(existing.id, {
        name,
        role,
        station: station as never,
        capabilities: { [station]: true },
        // keep existing wipLimit unless it's unset
      })
      updated++
    }
  }

  const data = await repos.agents.list({})

  return NextResponse.json({
    data,
    stats: {
      seen: agents.length,
      created,
      updated,
    },
  })
}
