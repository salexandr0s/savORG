import { prisma } from '../lib/db'
import {
  buildUniqueSlug,
  extractAgentIdFromSessionKey,
  normalizeActorRef,
  normalizeOwnerRef,
  slugifyDisplayName,
} from '../lib/agent-identity'

interface UnresolvedSample {
  id: string
  value: string
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
  } catch {
    return []
  }
}

function inferAgentKind(input: { role: string; station: string; runtimeAgentId: string; displayName: string }): 'worker' | 'manager' | 'ceo' | 'guard' {
  const text = normalize(`${input.role} ${input.station} ${input.runtimeAgentId} ${input.displayName}`)
  if (text.includes('ceo') || text.includes('chief') || text.includes('strategic')) return 'ceo'
  if (text.includes('guard') || text.includes('security-guard')) return 'guard'
  if (text.includes('manager') || text.includes('orchestration')) return 'manager'
  return 'worker'
}

function buildResolverMap(agents: Array<{
  id: string
  name: string
  displayName: string | null
  slug: string | null
  runtimeAgentId: string | null
  sessionKey: string
}>): Map<string, string> {
  const map = new Map<string, string>()

  for (const agent of agents) {
    const runtimeFromSession = extractAgentIdFromSessionKey(agent.sessionKey)
    const tokens = [
      agent.id,
      agent.name,
      agent.displayName,
      agent.slug,
      agent.runtimeAgentId,
      runtimeFromSession,
      `agent:${agent.id}`,
      agent.runtimeAgentId ? `agent:${agent.runtimeAgentId}` : null,
      agent.slug ? `agent:${agent.slug}` : null,
    ]

    for (const token of tokens) {
      const normalized = normalize(token)
      if (!normalized) continue
      if (!map.has(normalized)) map.set(normalized, agent.id)
    }
  }

  return map
}

async function backfillAgents(): Promise<void> {
  const agents = await prisma.agent.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      displayName: true,
      slug: true,
      runtimeAgentId: true,
      role: true,
      station: true,
      sessionKey: true,
      kind: true,
      dispatchEligible: true,
      nameSource: true,
    },
  })

  const usedSlugs = new Set<string>()
  for (const row of agents) {
    if (row.slug) usedSlugs.add(row.slug)
  }

  for (const row of agents) {
    const displayName = (row.displayName ?? row.name).trim() || row.name || row.id
    const slugBase = row.slug || slugifyDisplayName(displayName)
    const slug = buildUniqueSlug(slugBase, usedSlugs)
    usedSlugs.add(slug)

    const runtimeAgentId =
      (row.runtimeAgentId ?? '').trim() ||
      extractAgentIdFromSessionKey(row.sessionKey) ||
      slug

    const kind = inferAgentKind({
      role: row.role,
      station: row.station,
      runtimeAgentId,
      displayName,
    })

    const dispatchEligible = kind === 'worker'
    const nameSource = row.sessionKey.startsWith('agent:')
      ? (row.nameSource === 'user' ? 'user' : 'openclaw')
      : (row.nameSource === 'user' ? 'user' : 'system')

    await prisma.agent.update({
      where: { id: row.id },
      data: {
        name: displayName,
        displayName,
        slug,
        runtimeAgentId,
        kind,
        dispatchEligible,
        nameSource,
      },
    })
  }
}

async function backfillOperationAssignees(resolverMap: Map<string, string>): Promise<UnresolvedSample[]> {
  const unresolved: UnresolvedSample[] = []
  const operations = await prisma.operation.findMany({
    select: { id: true, assigneeAgentIds: true },
  })

  for (const operation of operations) {
    const assignees = parseJsonArray(operation.assigneeAgentIds)
    const nextIds = new Set<string>()

    for (const token of assignees) {
      const resolved = resolverMap.get(normalize(token))
      if (!resolved) {
        unresolved.push({ id: operation.id, value: token })
        continue
      }
      nextIds.add(resolved)
    }

    const nextJson = JSON.stringify(Array.from(nextIds))
    if (nextJson !== operation.assigneeAgentIds) {
      await prisma.operation.update({
        where: { id: operation.id },
        data: { assigneeAgentIds: nextJson },
      })
    }
  }

  return unresolved
}

async function backfillWorkOrderOwners(resolverMap: Map<string, string>): Promise<UnresolvedSample[]> {
  const unresolved: UnresolvedSample[] = []
  const workOrders = await prisma.workOrder.findMany({
    select: {
      id: true,
      owner: true,
      ownerType: true,
      ownerAgentId: true,
    },
  })

  for (const workOrder of workOrders) {
    const normalized = normalizeOwnerRef({
      owner: workOrder.owner,
      ownerType: workOrder.ownerType,
      ownerAgentId: workOrder.ownerAgentId,
    })

    let ownerAgentId = normalized.ownerAgentId
    if (normalized.ownerType === 'agent') {
      const resolved = ownerAgentId ? resolverMap.get(normalize(ownerAgentId)) : resolverMap.get(normalize(normalized.owner))
      if (!resolved) {
        unresolved.push({ id: workOrder.id, value: normalized.owner })
      } else {
        ownerAgentId = resolved
      }
    }

    const owner = normalized.ownerType === 'agent' && ownerAgentId
      ? `agent:${ownerAgentId}`
      : normalized.ownerType === 'system'
        ? 'system'
        : 'user'

    await prisma.workOrder.update({
      where: { id: workOrder.id },
      data: {
        owner,
        ownerType: normalized.ownerType,
        ownerAgentId: ownerAgentId ?? null,
      },
    })
  }

  return unresolved
}

async function backfillActivities(resolverMap: Map<string, string>): Promise<UnresolvedSample[]> {
  const unresolved: UnresolvedSample[] = []
  const activities = await prisma.activity.findMany({
    select: {
      id: true,
      actor: true,
      actorType: true,
      actorAgentId: true,
    },
  })

  for (const activity of activities) {
    const normalized = normalizeActorRef({
      actor: activity.actor,
      actorType: activity.actorType,
      actorAgentId: activity.actorAgentId,
    })

    let actorAgentId = normalized.actorAgentId
    if (normalized.actorType === 'agent') {
      const resolved = actorAgentId ? resolverMap.get(normalize(actorAgentId)) : resolverMap.get(normalize(normalized.actor))
      if (!resolved) {
        unresolved.push({ id: activity.id, value: normalized.actor })
      } else {
        actorAgentId = resolved
      }
    }

    const actor = normalized.actorType === 'agent' && actorAgentId
      ? `agent:${actorAgentId}`
      : normalized.actorType === 'system'
        ? 'system'
        : 'user'

    await prisma.activity.update({
      where: { id: activity.id },
      data: {
        actor,
        actorType: normalized.actorType,
        actorAgentId: actorAgentId ?? null,
      },
    })
  }

  return unresolved
}

async function backfillArtifacts(resolverMap: Map<string, string>): Promise<UnresolvedSample[]> {
  const unresolved: UnresolvedSample[] = []
  const artifacts = await prisma.artifact.findMany({
    select: {
      id: true,
      createdBy: true,
      createdByAgentId: true,
    },
  })

  for (const artifact of artifacts) {
    const current = artifact.createdByAgentId
    const resolved = current ? resolverMap.get(normalize(current)) : resolverMap.get(normalize(artifact.createdBy))

    if (!resolved && normalize(artifact.createdBy)) {
      unresolved.push({ id: artifact.id, value: artifact.createdBy })
      continue
    }

    if ((resolved ?? null) !== (artifact.createdByAgentId ?? null)) {
      await prisma.artifact.update({
        where: { id: artifact.id },
        data: { createdByAgentId: resolved ?? null },
      })
    }
  }

  return unresolved
}

function printUnresolved(label: string, unresolved: UnresolvedSample[]): void {
  if (unresolved.length === 0) {
    console.log(`${label}: 0 unresolved`)
    return
  }

  const samples = unresolved.slice(0, 10)
  console.error(`${label}: ${unresolved.length} unresolved`)
  for (const sample of samples) {
    console.error(`  - ${sample.id}: ${sample.value}`)
  }
}

async function main() {
  console.log('Starting backfill: agent identity refactor')

  await backfillAgents()
  const agents = await prisma.agent.findMany({
    select: {
      id: true,
      name: true,
      displayName: true,
      slug: true,
      runtimeAgentId: true,
      sessionKey: true,
    },
  })
  const resolverMap = buildResolverMap(agents)

  const [operationUnresolved, ownerUnresolved, activityUnresolved, artifactUnresolved] = await Promise.all([
    backfillOperationAssignees(resolverMap),
    backfillWorkOrderOwners(resolverMap),
    backfillActivities(resolverMap),
    backfillArtifacts(resolverMap),
  ])

  printUnresolved('operations.assigneeAgentIds', operationUnresolved)
  printUnresolved('work_orders.owner', ownerUnresolved)
  printUnresolved('activities.actor', activityUnresolved)
  printUnresolved('artifacts.createdBy', artifactUnresolved)

  const totalUnresolved =
    operationUnresolved.length +
    ownerUnresolved.length +
    activityUnresolved.length +
    artifactUnresolved.length

  if (totalUnresolved > 0) {
    throw new Error(`Backfill failed: ${totalUnresolved} unresolved references remain`)
  }

  console.log('Backfill complete: all references resolved')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
