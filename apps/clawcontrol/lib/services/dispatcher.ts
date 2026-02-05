import 'server-only'

import { prisma } from '../db'
import { dispatchToAgent, mapAgentToStation } from '../workflows/executor'

type DispatchSpecialty = 'plan' | 'build' | 'review' | 'research' | 'security' | 'ops' | 'ui'

const ACTIVE_OPERATION_STATUSES = ['todo', 'in_progress', 'review', 'rework'] as const
const ACTIVE_SESSION_MAX_AGE_MS = 5 * 60 * 1000
const DEFAULT_LIMIT = 25

let dispatchLoopInFlight = false

const SPECIALTY_KEYWORDS: Record<DispatchSpecialty, string[]> = {
  plan: ['planning', 'plan', 'design', 'architecture', 'spec'],
  build: ['coding', 'implementation', 'build', 'feature', 'bugfix', 'bug', 'fix'],
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
  name: string
  station: string
  status: string
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
  routingTemplate: string
  workflowId: string | null
  createdAt: Date
}

export interface DispatchAssignment {
  workOrderId: string
  code: string
  operationId: string | null
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

function inferSpecialties(agent: { name: string; station: string; role: string }): Set<DispatchSpecialty> {
  const text = normalizeText(`${agent.name} ${agent.station} ${agent.role}`)
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
  const lowered = normalizeText(agent.name)
  if (lowered.includes('manager') || lowered.includes('ceo') || lowered.includes('guard')) return false
  if (agent.status === 'blocked' || agent.status === 'error') return false
  return true
}

function pickAgent(
  availableAgents: AgentAvailability[],
  specialty: DispatchSpecialty
): AgentAvailability | null {
  const candidates = availableAgents.filter((agent) => agent.specialties.has(specialty))
  if (candidates.length > 0) {
    candidates.sort((a, b) => a.load - b.load || a.name.localeCompare(b.name))
    return candidates[0]
  }

  // Default fallback is build specialist, then any available dispatchable agent.
  if (specialty !== 'build') {
    const buildCandidates = availableAgents.filter((agent) => agent.specialties.has('build'))
    if (buildCandidates.length > 0) {
      buildCandidates.sort((a, b) => a.load - b.load || a.name.localeCompare(b.name))
      return buildCandidates[0]
    }
  }

  if (availableAgents.length === 0) return null
  const sorted = [...availableAgents].sort((a, b) => a.load - b.load || a.name.localeCompare(b.name))
  return sorted[0]
}

async function loadAvailability(): Promise<{
  eligibleAgents: AgentAvailability[]
  busyAgents: number
  openOperationCountByWorkOrder: Map<string, number>
}> {
  const [agents, operations, activeSessions] = await Promise.all([
    prisma.agent.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        role: true,
        station: true,
        status: true,
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
  const activeSessionAgents = new Set<string>()
  for (const session of activeSessions) {
    const seenAt = session.lastSeenAt?.getTime()
    if (!seenAt || seenAt < activeSessionCutoff) continue

    activeSessionAgents.add(normalizeText(session.agentId))

    const keyParts = session.sessionKey.split(':')
    if (keyParts[0] === 'agent' && keyParts[1]) {
      activeSessionAgents.add(normalizeText(keyParts[1]))
    }
  }

  const loadByAgentName = new Map<string, number>()
  const loadByAgentId = new Map<string, number>()
  const openOperationCountByWorkOrder = new Map<string, number>()

  for (const operation of operations) {
    openOperationCountByWorkOrder.set(
      operation.workOrderId,
      (openOperationCountByWorkOrder.get(operation.workOrderId) ?? 0) + 1
    )

    const assignees = parseAssignees(operation.assigneeAgentIds)
    for (const assignee of assignees) {
      const normalized = normalizeText(assignee)
      loadByAgentName.set(normalized, (loadByAgentName.get(normalized) ?? 0) + 1)
      loadByAgentId.set(normalized, (loadByAgentId.get(normalized) ?? 0) + 1)
    }
  }

  const allAgents: AgentAvailability[] = agents.map((agent) => {
    const normalizedName = normalizeText(agent.name)
    const normalizedId = normalizeText(agent.id)
    const currentLoad = Math.max(
      loadByAgentName.get(normalizedName) ?? 0,
      loadByAgentId.get(normalizedId) ?? 0
    )

    const hasActiveSession =
      activeSessionAgents.has(normalizedName) ||
      activeSessionAgents.has(normalizeText(agent.name.replace(/^Savorg/i, 'savorg')))

    const effectiveLoad = hasActiveSession ? Math.max(currentLoad, 1) : currentLoad

    return {
      id: agent.id,
      name: agent.name,
      station: agent.station,
      status: agent.status,
      wipLimit: Math.max(1, agent.wipLimit || 1),
      load: effectiveLoad,
      hasActiveSession,
      specialties: inferSpecialties({ name: agent.name, station: agent.station, role: agent.role }),
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
      station: mapAgentToStation(input.agent.name),
      title: `${input.agent.name} - Dispatch (${input.specialty})`,
      notes: `Dispatch loop assignment for ${input.workOrder.code}`,
      status: 'todo',
      assigneeAgentIds: JSON.stringify([input.agent.name]),
      dependsOnOperationIds: JSON.stringify([]),
      wipClass: 'implementation',
    },
  })

  return operation.id
}

export async function runManagerDispatchLoop(options?: {
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
        agentName: selectedAgent.name,
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
        agentName: selectedAgent.name,
        workOrderId: workOrder.id,
        operationId,
        task,
        context: {
          source: 'manager_dispatch_loop',
          workOrderId: workOrder.id,
          operationId,
          routingTemplate: workOrder.routingTemplate,
          specialty,
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
            owner: selectedAgent.name,
            blockedReason: null,
          },
        })

        await tx.activity.create({
          data: {
            type: 'manager.dispatch.assigned',
            actor: 'agent:clawcontrolmanager',
            entityType: 'work_order',
            entityId: workOrder.id,
            summary: `Dispatched ${workOrder.code} to ${selectedAgent.name}`,
            payloadJson: JSON.stringify({
              operationId,
              agent: selectedAgent.name,
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
        agentName: selectedAgent.name,
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
        await prisma.$transaction(async (tx) => {
          await tx.operation.update({
            where: { id: operationId! },
            data: {
              status: 'blocked',
              blockedReason: reason,
            },
          })

          await tx.workOrder.update({
            where: { id: workOrder.id },
            data: {
              state: 'blocked',
              blockedReason: reason,
            },
          })

          await tx.activity.create({
            data: {
              type: 'manager.dispatch.failed',
              actor: 'agent:clawcontrolmanager',
              entityType: 'work_order',
              entityId: workOrder.id,
              summary: `Dispatch failed for ${workOrder.code}`,
              payloadJson: JSON.stringify({
                operationId,
                agent: selectedAgent.name,
                specialty,
                error: reason,
              }),
            },
          })
        })
      }

      failures.push({
        workOrderId: workOrder.id,
        code: workOrder.code,
        agentName: selectedAgent.name,
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
