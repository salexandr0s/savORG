import 'server-only'

import { runCommand } from '@clawcontrol/adapters-openclaw'
import { getRepos } from '@/lib/repo'
import { prisma } from '@/lib/db'
import { getOpenClawConfig } from '@/lib/openclaw-client'
import { buildOpenClawSessionKey, inferDefaultAgentWipLimit, slugifyDisplayName } from '@/lib/agent-identity'

export interface SyncAgentsOptions {
  forceRefresh?: boolean
}

export interface SyncAgentsResult {
  added: number
  updated: number
  stale: number
  source: 'cli' | 'config'
}

interface OpenClawAgentConfig {
  id: string
  identity?: string
  name?: string
  model?: string
  fallbacks?: string[]
}

function inferDisplayName(agent: OpenClawAgentConfig): string {
  return agent.identity || agent.name || agent.id
}

function inferSessionKey(agentId: string): string {
  return buildOpenClawSessionKey(agentId)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  const normalized = value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item))

  return normalized
}

function extractModel(value: unknown): { model?: string; fallbacks?: string[] } {
  if (typeof value === 'string') {
    const model = asString(value)
    return model ? { model } : {}
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}

  const record = value as Record<string, unknown>
  const model =
    asString(record.primary)
    || asString(record.model)
    || asString(record.id)
    || asString(record.key)

  const fallbacks = asStringArray(record.fallbacks) ?? []

  return {
    ...(model ? { model } : {}),
    ...(record.fallbacks !== undefined ? { fallbacks } : {}),
  }
}

function normalizeAgentRecord(input: unknown): OpenClawAgentConfig | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null

  const record = input as Record<string, unknown>
  const id = asString(record.id)
  if (!id) return null

  const identity =
    asString(record.identity)
    || asString((record.identity as Record<string, unknown> | undefined)?.name)
    || asString(record.name)

  const modelConfig = extractModel(record.model)

  return {
    id,
    ...(identity ? { identity } : {}),
    ...(modelConfig.model ? { model: modelConfig.model } : {}),
    ...(modelConfig.fallbacks !== undefined ? { fallbacks: modelConfig.fallbacks } : {}),
  }
}

function normalizeCliPayload(payload: unknown): OpenClawAgentConfig[] {
  if (Array.isArray(payload)) {
    return payload
      .map((entry) => normalizeAgentRecord(entry))
      .filter((entry): entry is OpenClawAgentConfig => Boolean(entry))
  }

  if (!payload || typeof payload !== 'object') return []

  const record = payload as Record<string, unknown>
  const list =
    (Array.isArray(record.agents) ? record.agents : null)
    || (Array.isArray(record.list) ? record.list : null)
    || []

  return list
    .map((entry) => normalizeAgentRecord(entry))
    .filter((entry): entry is OpenClawAgentConfig => Boolean(entry))
}

async function discoverAgents(forceRefresh: boolean): Promise<{ agents: OpenClawAgentConfig[]; source: 'cli' | 'config' }> {
  const cliResult = await runCommand('config.agents.list.json')
  if (cliResult.exitCode === 0) {
    try {
      const parsed = JSON.parse(cliResult.stdout)
      const agents = normalizeCliPayload(parsed)
      return { agents, source: 'cli' }
    } catch {
      // Fall through to file-based discovery.
    }
  }

  const config = await getOpenClawConfig(forceRefresh)
  if (!config) {
    throw new Error('OpenClaw config not found in CLI output, settings, or local config files')
  }

  const agents: OpenClawAgentConfig[] = []
  for (const agent of config.agents) {
    if (!agent?.id) continue
    agents.push({
      id: agent.id,
      ...(agent.identity ? { identity: agent.identity } : {}),
      ...(agent.model ? { model: agent.model } : {}),
      ...(Array.isArray(agent.fallbacks) ? { fallbacks: agent.fallbacks } : {}),
    })
  }

  return {
    agents,
    source: 'config',
  }
}

async function getDefaultStationId(): Promise<string> {
  const repos = getRepos()

  const ops = await repos.stations.getById('ops')
  if (ops) return 'ops'

  const stations = await repos.stations.list()
  return stations[0]?.id ?? 'ops'
}

export async function syncAgentsFromOpenClaw(
  options: SyncAgentsOptions = {}
): Promise<SyncAgentsResult> {
  const { agents, source } = await discoverAgents(Boolean(options.forceRefresh))

  const repos = getRepos()
  const defaultStationId = await getDefaultStationId()

  let added = 0
  let updated = 0

  const seenSessionKeys = new Set<string>()

  for (const agent of agents) {
    if (!agent?.id) continue

    const name = inferDisplayName(agent)
    const sessionKey = inferSessionKey(agent.id)
    const fallbacks = Array.isArray(agent.fallbacks) ? agent.fallbacks : undefined
    const existing =
      (await repos.agents.getBySessionKey(sessionKey))
      ?? (await repos.agents.getByName(agent.id))

    seenSessionKeys.add(sessionKey)

    if (!existing) {
      await repos.agents.create({
        name,
        displayName: name,
        slug: slugifyDisplayName(name),
        runtimeAgentId: agent.id,
        kind: 'worker',
        dispatchEligible: true,
        nameSource: 'openclaw',
        role: 'agent',
        station: defaultStationId,
        sessionKey,
        capabilities: { [defaultStationId]: true },
        wipLimit: inferDefaultAgentWipLimit({
          id: agent.id,
          name,
          station: defaultStationId,
        }),
        isStale: false,
        staleAt: null,
        ...(agent.model ? { model: agent.model } : {}),
        ...(fallbacks !== undefined ? { fallbacks: JSON.stringify(fallbacks) } : {}),
      })
      added++
    } else {
      await repos.agents.update(existing.id, {
        ...(existing.nameSource === 'user'
          ? {}
          : {
              displayName: name,
              nameSource: 'openclaw',
            }),
        runtimeAgentId: agent.id,
        isStale: false,
        staleAt: null,
        ...(agent.model ? { model: agent.model } : {}),
        ...(fallbacks !== undefined ? { fallbacks: JSON.stringify(fallbacks) } : {}),
      })
      updated++
    }
  }

  const openClawAgents = await prisma.agent.findMany({
    where: {
      OR: [
        { nameSource: 'openclaw' },
        { sessionKey: { startsWith: 'agent:' } },
      ],
    },
    select: { id: true, sessionKey: true },
  })

  let stale = 0
  const staleAt = new Date()

  for (const dbAgent of openClawAgents) {
    if (seenSessionKeys.has(dbAgent.sessionKey)) continue

    await prisma.agent.update({
      where: { id: dbAgent.id },
      data: {
        isStale: true,
        staleAt,
      },
    })
    stale++
  }

  return { added, updated, stale, source }
}
