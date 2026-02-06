import 'server-only'

import { prisma } from '../db'
import { dispatchToAgent } from '../workflows/executor'
import { extractAgentIdFromSessionKey } from '../agent-identity'

/**
 * Automated Dispatch System
 *
 * Responsibilities:
 * - Poll planned queue on schedule
 * - Match work orders to eligible agents using station/capability hints
 * - Spawn agent sessions for the selected operation
 * - Update work orders from planned -> active with assigned owner
 * - Write dispatch activity receipts
 *
 * Does NOT:
 * - Evaluate work quality/completion
 * - Advance review/shipping decisions
 * - Resolve blocker exceptions on behalf of manager workflows
 */

type DispatchSpecialty = 'plan' | 'build' | 'review' | 'research' | 'security' | 'ops' | 'ui'

const ACTIVE_OPERATION_STATUSES = ['todo', 'in_progress', 'review', 'rework'] as const
const ACTIVE_SESSION_MAX_AGE_MS = 5 * 60 * 1000
const DEFAULT_LIMIT = 25
const DISPATCH_ACTIVITY_ACTOR = 'system'

let dispatchLoopInFlight = false

const SPECIALTY_KEYWORDS: Record<DispatchSpecialty, string[]> = {
  plan: ['plan', 'design', 'architecture', 'spec'],
  build: ['build', 'implementation', 'feature', 'bugfix', 'bug', 'fix'],
  review: ['review', 'qa', 'testing', 'audit'],
  research: ['research', 'analysis', 'investigation'],
  security: ['security', 'auth', 'permissions', 'vulnerability'],
  ops: ['ops', 'infrastructure', 'infra', 'deploy', 'monitoring', 'cron'],
  ui: ['ui', 'frontend', 'ux', 'interface'],
}

const ROUTING_TEMPLATE_SPECIALTY: Record<string, DispatchSpecialty> = {
  ui_feature: 'ui',
  research_only: 'research',
  security_audit: 'security',
  ops_task: 'ops',
  bug_fix: 'build',
  feature_request: 'build',
  full_stack_feature: 'build',
  hotfix: 'build',
}

interface AgentAvailability {
  id: string
  displayName: string
  runtimeAgentId: string
  station: string
  status: string
  kind: string
  dispatchEligible: boolean
  wipLimit: number
  load: number
  hasActiveSession: boolean
  specialties: Set<DispatchSpecialty>
}

interface PlannedWorkOrder {
  id: string
  code: string
  title: string
  goalMd: string
  state: string
  owner: string
  ownerType: string
  ownerAgentId: string | null
  routingTemplate: string
  workflowId: string | null
  createdAt: Date
}

export interface DispatchAssignment {
  workOrderId: string
  code: string
  operationId: string | null
  agentId: string
  agentName: string
  specialty: DispatchSpecialty
  status: 'dispatched' | 'dry_run'
  sessionKey?: string
}

export interface DispatchSkip {
  workOrderId: string
  code: string
  reason: string
}

export interface DispatchFailure {
  workOrderId: string
  code: string
  agentId: string
  agentName: string
  reason: string
  operationId: string | null
}

export interface DispatchLoopResult {
  dryRun: boolean
  plannedScanned: number
  dispatched: number
  failed: number
  skipped: number
  overlapPrevented: boolean
  assignments: DispatchAssignment[]
  failures: DispatchFailure[]
  skips: DispatchSkip[]
  summary: {
    eligibleAgents: number
    busyAgents: number
    queuedPlanned: number
    timestamp: string
  }
}

function normalizeText(input: string): string {
  return input.trim().toLowerCase()
}

function tokenize(input: string): string[] {
  const matches = normalizeText(input).match(/[a-z0-9_-]+/g)
  return matches ?? []
}

function parseCapabilities(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return []
    return Object.entries(parsed as Record<string, unknown>)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => normalizeText(key))
  } catch {
    return []
  }
}

function inferSpecialties(agent: { station: string; role: string; capabilities: string[] }): Set<DispatchSpecialty> {
  const text = normalizeText(`${agent.station} ${agent.role} ${agent.capabilities.join(' ')}`)
  const specialties = new Set<DispatchSpecialty>()

  if (text.includes('security')) specialties.add('security')
  if (text.includes('research')) specialties.add('research')
  if (text.includes('ops') || text.includes('infra')) specialties.add('ops')
  if (text.includes('plan') || text.includes('spec') || text.includes('architect')) specialties.add('plan')
  if (text.includes('review') || text.includes('qa') || text.includes('audit')) specialties.add('review')
  if (text.includes('ui') || text.includes('front')) specialties.add('ui')
  if (text.includes('build') || text.includes('implement') || text.includes('code')) specialties.add('build')

  if (specialties.size === 0) specialties.add('build')
  return specialties
}

function inferWorkOrderSpecialty(workOrder: PlannedWorkOrder): DispatchSpecialty {
  const template = normalizeText(workOrder.routingTemplate)
  if (template && ROUTING_TEMPLATE_SPECIALTY[template]) {
    return ROUTING_TEMPLATE_SPECIALTY[template]
  }

  if (workOrder.workflowId && ROUTING_TEMPLATE_SPECIALTY[workOrder.workflowId]) {
    return ROUTING_TEMPLATE_SPECIALTY[workOrder.workflowId]
  }

  const tokens = new Set(
    tokenize(`${workOrder.title} ${workOrder.goalMd} ${workOrder.routingTemplate} ${workOrder.workflowId ?? ''}`)
  )

  let best: DispatchSpecialty = 'build'
  let bestScore = 0

  for (const [specialty, keywords] of Object.entries(SPECIALTY_KEYWORDS) as Array<
    [DispatchSpecialty, string[]]
  >) {
    let score = 0
    for (const keyword of keywords) {
      if (tokens.has(keyword)) score += 1
    }
    if (score > bestScore) {
      bestScore = score
      best = specialty
    }
  }

  return best
}

function parseAssignees(input: string): string[] {
  try {
    const parsed = JSON.parse(input) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    return []
  }
}

function isDispatchableAgent(agent: AgentAvailability): boolean {
  if (agent.kind !== 'worker') return false
  if (!agent.dispatchEligible) return false
  if (agent.status === 'blocked' || agent.status === 'error') return false
  return true
}

function pickAgent(
  availableAgents: AgentAvailability[],
  specialty: DispatchSpecialty
): AgentAvailability | null {
  const candidates = availableAgents.filter((agent) => agent.specialties.has(specialty))
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.load - b.load || a.displayName.localeCompare(b.displayName))
    return candidates[0]
  }

  // Default fallback is build specialist, then any available dispatchable agent.
  if (specialty !== 'build') {
    const buildCandidates = availableAgents.filter((agent) => agent.specialties.has('build'))
    if (buildCandidates.length > 0) {
      buildCandidates.sort((a, b) => a.load - b.load || a.displayName.localeCompare(b.displayName))
      return buildCandidates[0]
    }
  }

  if (availableAgents.length === 0) return null
  const sorted = [...availableAgents].sort((a, b) => a.load - b.load || a.displayName.localeCompare(b.displayName))
  return sorted[0]
}

function buildAgentTokens(agent: {
  id: string
  name: string
  displayName: string | null
  slug: string | null
  runtimeAgentId: string | null
  sessionKey: string
}): string[] {
  const tokens = new Set<string>()
  const values = [
    agent.id,
    agent.name,
    agent.displayName,
    agent.slug,
    agent.runtimeAgentId,
    extractAgentIdFromSessionKey(agent.sessionKey),
  ]

  for (const value of values) {
    const normalized = normalizeText(value ?? '')
    if (!normalized) continue
    tokens.add(normalized)
    tokens.add(normalized.replace(/[\s_-]+/g, ''))
  }

  return Array.from(tokens)
}

async function loadAvailability(): Promise<{
  eligibleAgents: AgentAvailability[]
  busyAgents: number
  openOperationCountByWorkOrder: Map<string, number>
}> {
  const [agents, operations, activeSessions] = await Promise.all([
    prisma.agent.findMany({
      orderBy: [{ displayName: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        displayName: true,
        slug: true,
        runtimeAgentId: true,
        role: true,
        station: true,
        status: true,
        kind: true,
        dispatchEligible: true,
        sessionKey: true,
        capabilities: true,
        wipLimit: true,
      },
    }),
    prisma.operation.findMany({
      where: {
        status: { in: [...ACTIVE_OPERATION_STATUSES] },
      },
      select: {
        workOrderId: true,
        assigneeAgentIds: true,
      },
    }),
    prisma.agentSession.findMany({
      where: {
        state: 'active',
      },
      select: {
        agentId: true,
        sessionKey: true,
        lastSeenAt: true,
      },
    }),
  ])

  const activeSessionCutoff = Date.now() - ACTIVE_SESSION_MAX_AGE_MS
  const activeSessionTokens = new Set<string>()
  for (const session of activeSessions) {
    const seenAt = session.lastSeenAt?.getTime()
    if (!seenAt || seenAt < activeSessionCutoff) continue

    const agentToken = normalizeText(session.agentId)
    if (agentToken) activeSessionTokens.add(agentToken)

    const runtime = extractAgentIdFromSessionKey(session.sessionKey)
    if (runtime) activeSessionTokens.add(normalizeText(runtime))
  }

  const loadByToken = new Map<string, number>()
  const openOperationCountByWorkOrder = new Map<string, number>()

  for (const operation of operations) {
    openOperationCountByWorkOrder.set(
      operation.workOrderId,
      (openOperationCountByWorkOrder.get(operation.workOrderId) ?? 0) + 1
    )

    const assignees = parseAssignees(operation.assigneeAgentIds)
    for (const assignee of assignees) {
      const normalized = normalizeText(assignee)
      if (!normalized) continue
      loadByToken.set(normalized, (loadByToken.get(normalized) ?? 0) + 1)
    }
  }

  const allAgents: AgentAvailability[] = agents.map((agent) => {
    const tokens = buildAgentTokens(agent)
    const currentLoad = tokens.reduce((max, token) => Math.max(max, loadByToken.get(token) ?? 0), 0)
    const hasActiveSession = tokens.some((token) => activeSessionTokens.has(token))
    const effectiveLoad = hasActiveSession ? Math.max(currentLoad, 1) : currentLoad

    const displayName = agent.displayName?.trim() || agent.name
    const runtimeAgentId =
      agent.runtimeAgentId?.trim() ||
      extractAgentIdFromSessionKey(agent.sessionKey) ||
      agent.slug?.trim() ||
      agent.id

    return {
      id: agent.id,
      displayName,
      runtimeAgentId,
      station: agent.station,
      status: agent.status,
      kind: agent.kind || 'worker',
      dispatchEligible: agent.dispatchEligible !== false,
      wipLimit: Math.max(1, agent.wipLimit || 1),
      load: effectiveLoad,
      hasActiveSession,
      specialties: inferSpecialties({
        station: agent.station,
        role: agent.role,
        capabilities: parseCapabilities(agent.capabilities),
      }),
    }
  })

  const eligibleAgents = allAgents.filter(
    (agent) => isDispatchableAgent(agent) && agent.load < agent.wipLimit
  )

  const busyAgents = allAgents.length - eligibleAgents.length

  return {
    eligibleAgents,
    busyAgents,
    openOperationCountByWorkOrder,
  }
}

async function createDispatchOperation(input: {
  workOrder: PlannedWorkOrder
  agent: AgentAvailability
  specialty: DispatchSpecialty
}): Promise<string> {
  const operation = await prisma.operation.create({
    data: {
      workOrderId: input.workOrder.id,
      station: input.agent.station || 'build',
      title: `${input.agent.displayName} - Dispatch (${input.specialty})`,
      notes: `Dispatch loop assignment for ${input.workOrder.code}`,
      status: 'todo',
      assigneeAgentIds: JSON.stringify([input.agent.id]),
      dependsOnOperationIds: JSON.stringify([]),
      wipClass: 'implementation',
    },
  })

  return operation.id
}

export async function runAutomatedDispatchLoop(options?: {
  limit?: number
  dryRun?: boolean
  allowConcurrent?: boolean
}): Promise<DispatchLoopResult> {
  const allowConcurrent = options?.allowConcurrent ?? false

  if (!allowConcurrent && dispatchLoopInFlight) {
    return {
      dryRun: Boolean(options?.dryRun),
      plannedScanned: 0,
      dispatched: 0,
      failed: 0,
      skipped: 1,
      overlapPrevented: true,
      assignments: [],
      failures: [],
      skips: [
        {
          workOrderId: '',
          code: '',
          reason: 'Dispatch loop already running; overlap prevented',
        },
      ],
      summary: {
        eligibleAgents: 0,
        busyAgents: 0,
        queuedPlanned: 0,
        timestamp: new Date().toISOString(),
      },
    }
  }

  dispatchLoopInFlight = true
  try {
    const limit = Math.min(Math.max(options?.limit ?? DEFAULT_LIMIT, 1), 100)
    const dryRun = options?.dryRun ?? false

    const planned = (await prisma.workOrder.findMany({
      where: {
        state: 'planned',
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        code: true,
        title: true,
        goalMd: true,
        state: true,
        owner: true,
        ownerType: true,
        ownerAgentId: true,
        routingTemplate: true,
        workflowId: true,
        createdAt: true,
      },
    })) as PlannedWorkOrder[]

    const { eligibleAgents, busyAgents, openOperationCountByWorkOrder } = await loadAvailability()
    const assignments: DispatchAssignment[] = []
    const failures: DispatchFailure[] = []
    const skips: DispatchSkip[] = []

    if (planned.length === 0) {
      return {
        dryRun,
        plannedScanned: 0,
        dispatched: 0,
        failed: 0,
        skipped: 0,
        overlapPrevented: false,
        assignments,
        failures,
        skips,
        summary: {
          eligibleAgents: eligibleAgents.length,
          busyAgents,
          queuedPlanned: 0,
          timestamp: new Date().toISOString(),
        },
      }
    }

    const mutableAgents = eligibleAgents.map((agent) => ({ ...agent, specialties: new Set(agent.specialties) }))

    for (const workOrder of planned) {
      if ((openOperationCountByWorkOrder.get(workOrder.id) ?? 0) > 0) {
        skips.push({
          workOrderId: workOrder.id,
          code: workOrder.code,
          reason: 'Work order already has open operations',
        })
        continue
      }

      const specialty = inferWorkOrderSpecialty(workOrder)
      const selectedAgent = pickAgent(mutableAgents, specialty)

      if (!selectedAgent) {
        skips.push({
          workOrderId: workOrder.id,
          code: workOrder.code,
          reason: `No available agent for specialty: ${specialty}`,
        })
        continue
      }

      if (dryRun) {
        assignments.push({
          workOrderId: workOrder.id,
          code: workOrder.code,
          operationId: null,
          agentId: selectedAgent.id,
          agentName: selectedAgent.displayName,
          specialty,
          status: 'dry_run',
        })
        selectedAgent.load += 1
        if (selectedAgent.load >= selectedAgent.wipLimit) {
          const idx = mutableAgents.findIndex((agent) => agent.id === selectedAgent.id)
          if (idx >= 0) mutableAgents.splice(idx, 1)
        }
        continue
      }

      let operationId: string | null = null

      try {
        operationId = await createDispatchOperation({
          workOrder,
          agent: selectedAgent,
          specialty,
        })

        const task = [
          `Work Order: ${workOrder.code}`,
          `Title: ${workOrder.title}`,
          '',
          workOrder.goalMd,
        ].join('\n')

        const spawned = await dispatchToAgent({
          agentId: selectedAgent.id,
          workOrderId: workOrder.id,
          operationId,
          task,
          context: {
            source: 'automated_dispatch_loop',
            workOrderId: workOrder.id,
            operationId,
            routingTemplate: workOrder.routingTemplate,
            specialty,
            agentId: selectedAgent.id,
            agentName: selectedAgent.displayName,
            runtimeAgentId: selectedAgent.runtimeAgentId,
          },
        })

        await prisma.$transaction(async (tx) => {
          await tx.operation.update({
            where: { id: operationId! },
            data: {
              status: 'in_progress',
              blockedReason: null,
            },
          })

          await tx.workOrder.update({
            where: { id: workOrder.id },
            data: {
              state: 'active',
              owner: `agent:${selectedAgent.id}`,
              ownerType: 'agent',
              ownerAgentId: selectedAgent.id,
              blockedReason: null,
            },
          })

          await tx.activity.create({
            data: {
              type: 'dispatch.assigned',
              actor: DISPATCH_ACTIVITY_ACTOR,
              actorType: 'system',
              actorAgentId: null,
              entityType: 'work_order',
              entityId: workOrder.id,
              summary: `Auto-dispatched ${workOrder.code} to ${selectedAgent.displayName}`,
              payloadJson: JSON.stringify({
                operationId,
                agentId: selectedAgent.id,
                agentName: selectedAgent.displayName,
                specialty,
                sessionKey: spawned.sessionKey,
                sessionId: spawned.sessionId,
              }),
            },
          })
        })

        assignments.push({
          workOrderId: workOrder.id,
          code: workOrder.code,
          operationId,
          agentId: selectedAgent.id,
          agentName: selectedAgent.displayName,
          specialty,
          status: 'dispatched',
          sessionKey: spawned.sessionKey,
        })

        selectedAgent.load += 1
        if (selectedAgent.load >= selectedAgent.wipLimit) {
          const idx = mutableAgents.findIndex((agent) => agent.id === selectedAgent.id)
          if (idx >= 0) mutableAgents.splice(idx, 1)
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)

        if (operationId) {
          // Dispatch stays strictly in routing/spawn scope. If spawn fails, keep
          // work order in planned queue for retry and clean up the transient op.
          await prisma.operation
            .delete({ where: { id: operationId } })
            .catch(() => {})
        }

        await prisma.activity.create({
          data: {
            type: 'dispatch.failed',
            actor: DISPATCH_ACTIVITY_ACTOR,
            actorType: 'system',
            actorAgentId: null,
            entityType: 'work_order',
            entityId: workOrder.id,
            summary: `Auto-dispatch failed for ${workOrder.code}`,
            payloadJson: JSON.stringify({
              operationId,
              agentId: selectedAgent.id,
              agentName: selectedAgent.displayName,
              specialty,
              error: reason,
            }),
          },
        })

        failures.push({
          workOrderId: workOrder.id,
          code: workOrder.code,
          agentId: selectedAgent.id,
          agentName: selectedAgent.displayName,
          reason,
          operationId,
        })
      }
    }

    return {
      dryRun,
      plannedScanned: planned.length,
      dispatched: assignments.filter((a) => a.status === 'dispatched').length,
      failed: failures.length,
      skipped: skips.length,
      overlapPrevented: false,
      assignments,
      failures,
      skips,
      summary: {
        eligibleAgents: eligibleAgents.length,
        busyAgents,
        queuedPlanned: planned.length,
        timestamp: new Date().toISOString(),
      },
    }
  } finally {
    dispatchLoopInFlight = false
  }
}

/**
 * Backward-compatible alias used by existing imports.
 */
export const runManagerDispatchLoop = runAutomatedDispatchLoop
