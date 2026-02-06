import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '../db'
import { WORKFLOWS } from '../workflows/definitions'
import {
  advanceWorkflowTx,
  dispatchToAgent,
  evaluateCondition,
  mapAgentToStation,
  type StageResult,
} from '../workflows/executor'
import { sendToSession } from '../openclaw/sessions'
import { resolveCeoSessionKey, resolveWorkflowStageAgent } from './agent-resolution'
import { buildOpenClawSessionKey } from '../agent-identity'

const MANAGER_ACTIVITY_ACTOR = 'system:manager'
const DEFAULT_CEO_SESSION_KEY = buildOpenClawSessionKey('main')

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ error: 'UNSERIALIZABLE_OUTPUT' })
  }
}

function inferArtifactType(pathOrUrl: string): string {
  if (pathOrUrl.includes('github.com/') && pathOrUrl.includes('/pull/')) return 'pr'
  if (pathOrUrl.endsWith('.md')) return 'doc'
  if (pathOrUrl.endsWith('.png') || pathOrUrl.endsWith('.jpg') || pathOrUrl.endsWith('.jpeg')) {
    return 'screenshot'
  }
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')) return 'link'
  return 'file'
}

function parseAssignees(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === 'string' && value.length > 0)
  } catch {
    return []
  }
}

async function getCeoSessionKey(): Promise<string> {
  const resolved = await resolveCeoSessionKey(prisma)
  return resolved ?? DEFAULT_CEO_SESSION_KEY
}

async function loadInitialContext(
  tx: Prisma.TransactionClient,
  workOrderId: string
): Promise<Record<string, unknown>> {
  const row = await tx.activity.findFirst({
    where: {
      entityType: 'work_order',
      entityId: workOrderId,
      type: 'workflow.started',
    },
    orderBy: { ts: 'desc' },
  })

  if (!row) return {}

  try {
    const payload = JSON.parse(row.payloadJson) as { initialContext?: unknown }
    if (payload?.initialContext && typeof payload.initialContext === 'object') {
      return payload.initialContext as Record<string, unknown>
    }
  } catch {
    // ignore
  }

  return {}
}

function parseStageAgentContext(result: StageResult): {
  agentId: string | null
  agentName: string | null
  runtimeAgentId: string | null
} {
  const output = result.output
  if (!output || typeof output !== 'object') {
    return { agentId: null, agentName: null, runtimeAgentId: null }
  }

  const maybe = output as Record<string, unknown>
  const context = maybe.context && typeof maybe.context === 'object'
    ? maybe.context as Record<string, unknown>
    : maybe

  const agentId = typeof context.agentId === 'string' ? context.agentId : null
  const agentName = typeof context.agentName === 'string' ? context.agentName : null
  const runtimeAgentId = typeof context.runtimeAgentId === 'string' ? context.runtimeAgentId : null

  return { agentId, agentName, runtimeAgentId }
}

export async function initiateWorkflow(
  workOrderId: string,
  workflowId: string,
  initialContext: Record<string, unknown> = {}
): Promise<{ operationId: string; agentId: string; agentName: string; sessionKey: string | null }> {
  const workflow = WORKFLOWS[workflowId]
  if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`)

  // Find first stage, skipping optional stages when condition is false.
  let startIndex = 0
  while (startIndex < workflow.stages.length) {
    const stage = workflow.stages[startIndex]
    if (stage.optional && stage.condition) {
      const conditionMet = evaluateCondition(stage.condition, initialContext)
      if (!conditionMet) {
        startIndex++
        continue
      }
    }
    break
  }

  if (startIndex >= workflow.stages.length) {
    throw new Error(`Workflow ${workflowId} has no runnable stages`)
  }

  const firstStage = workflow.stages[startIndex]
  const firstStageAgent = await resolveWorkflowStageAgent(prisma, firstStage.agent)
  if (!firstStageAgent) {
    throw new Error(`No available agent for workflow stage: ${firstStage.agent}`)
  }

  const { operationId } = await prisma.$transaction(async (tx) => {
    // Ensure work order exists and update workflow metadata
    const workOrder = await tx.workOrder.findUnique({ where: { id: workOrderId } })
    if (!workOrder) throw new Error(`Work order not found: ${workOrderId}`)

    await tx.workOrder.update({
      where: { id: workOrderId },
      data: {
        workflowId,
        currentStage: startIndex,
        state: 'active',
        blockedReason: null,
      },
    })

    await tx.activity.create({
      data: {
        type: 'workflow.started',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'work_order',
        entityId: workOrderId,
        summary: `Started workflow: ${workflowId}`,
        payloadJson: JSON.stringify({
          workflowId,
          startIndex,
          firstStage: firstStage.agent,
          firstAgentId: firstStageAgent.id,
          firstAgentName: firstStageAgent.displayName,
          initialContext,
        }),
      },
    })

    const op = await tx.operation.create({
      data: {
        workOrderId,
        station: mapAgentToStation({ station: firstStageAgent.station }),
        title: `${firstStageAgent.displayName} — Stage ${startIndex + 1}/${workflow.stages.length}`,
        status: 'todo',
        workflowId,
        workflowStageIndex: startIndex,
        iterationCount: 0,
        assigneeAgentIds: JSON.stringify([firstStageAgent.id]),
      },
    })

    return { operationId: op.id }
  })

  const workOrder = await prisma.workOrder.findUnique({ where: { id: workOrderId } })
  if (!workOrder) throw new Error(`Work order not found: ${workOrderId}`)

  try {
    const spawned = await dispatchToAgent({
      agentId: firstStageAgent.id,
      workOrderId,
      operationId,
      task: workOrder.goalMd ?? '',
      context: {
        workOrderId,
        operationId,
        workflowId,
        stageIndex: startIndex,
        initialContext,
        agentId: firstStageAgent.id,
        agentName: firstStageAgent.displayName,
        runtimeAgentId: firstStageAgent.runtimeAgentId,
      },
    })

    await prisma.operation.update({
      where: { id: operationId },
      data: { status: 'in_progress' },
    })

    await prisma.activity.create({
      data: {
        type: 'workflow.dispatched',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'operation',
        entityId: operationId,
        summary: `Dispatched ${firstStageAgent.displayName} for stage ${startIndex + 1}`,
        payloadJson: JSON.stringify({
          workflowId,
          stageIndex: startIndex,
          stageRef: firstStage.agent,
          agentId: firstStageAgent.id,
          agentName: firstStageAgent.displayName,
          sessionKey: spawned.sessionKey,
          sessionId: spawned.sessionId,
        }),
      },
    })

    return {
      operationId,
      agentId: firstStageAgent.id,
      agentName: firstStageAgent.displayName,
      sessionKey: spawned.sessionKey,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dispatch failed'

    await prisma.operation.update({
      where: { id: operationId },
      data: { status: 'blocked', blockedReason: message },
    })

    await prisma.activity.create({
      data: {
        type: 'workflow.dispatch_failed',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'operation',
        entityId: operationId,
        summary: `Dispatch failed for ${firstStageAgent.displayName}`,
        payloadJson: JSON.stringify({
          workflowId,
          stageIndex: startIndex,
          stageRef: firstStage.agent,
          agentId: firstStageAgent.id,
          agentName: firstStageAgent.displayName,
          error: message,
        }),
      },
    })

    return {
      operationId,
      agentId: firstStageAgent.id,
      agentName: firstStageAgent.displayName,
      sessionKey: null,
    }
  }
}

export async function handleAgentCompletion(operationId: string, result: StageResult): Promise<void> {
  const now = new Date()

  const advance = await prisma.$transaction(async (tx) => {
    const operation = await tx.operation.findUnique({
      where: { id: operationId },
      include: { workOrder: true },
    })

    if (!operation) throw new Error(`Operation not found: ${operationId}`)

    const workOrderId = operation.workOrderId
    const workflowId = operation.workflowId ?? operation.workOrder.workflowId
    if (!workflowId) {
      throw new Error(`Operation ${operationId} missing workflowId`)
    }

    const workflow = WORKFLOWS[workflowId]
    if (!workflow) throw new Error(`Unknown workflow: ${workflowId}`)

    const stageIndex = operation.workflowStageIndex
    const stage = workflow.stages[stageIndex]
    const stageRef = stage?.agent ?? 'unknown'
    const assignees = parseAssignees(operation.assigneeAgentIds)
    const parsedContext = parseStageAgentContext(result)
    const currentAgentId = assignees[0] ?? parsedContext.agentId

    const currentAgent = currentAgentId
      ? await tx.agent.findUnique({
          where: { id: currentAgentId },
          select: {
            id: true,
            name: true,
            displayName: true,
            runtimeAgentId: true,
            slug: true,
          },
        })
      : null

    const currentAgentName =
      currentAgent?.displayName?.trim() ||
      currentAgent?.name ||
      parsedContext.agentName ||
      currentAgentId ||
      stageRef

    const runtimeAgentId =
      currentAgent?.runtimeAgentId?.trim() ||
      currentAgent?.slug?.trim() ||
      parsedContext.runtimeAgentId ||
      currentAgentId ||
      stageRef

    const success = result.status === 'approved' || result.status === 'completed'

    await tx.operation.update({
      where: { id: operationId },
      data: {
        status: success ? 'done' : 'blocked',
        notes: result.feedback ?? null,
        blockedReason: success ? null : (result.feedback ?? result.status),
      },
    })

    // Receipt (agent output)
    await tx.receipt.create({
      data: {
        workOrderId,
        operationId,
        kind: 'agent_run',
        commandName: `agent:${runtimeAgentId}`,
        commandArgsJson: JSON.stringify({
          workflowId,
          stageIndex,
          stageRef,
          agentId: currentAgentId,
          agentName: currentAgentName,
          runtimeAgentId,
          iterationCount: operation.iterationCount,
          status: result.status,
        }),
        exitCode: success ? 0 : 1,
        durationMs: null,
        stdoutExcerpt: '',
        stderrExcerpt: '',
        parsedJson: safeJsonStringify({
          status: result.status,
          output: result.output,
          feedback: result.feedback,
          artifacts: result.artifacts,
        }),
        startedAt: now,
        endedAt: now,
      },
    })

    // Artifacts
    if (Array.isArray(result.artifacts)) {
      for (const artifact of result.artifacts) {
        if (!artifact || typeof artifact !== 'string') continue
        await tx.artifact.create({
          data: {
            workOrderId,
            operationId,
            type: inferArtifactType(artifact),
            title: artifact,
            pathOrUrl: artifact,
            createdBy: currentAgentName,
            createdByAgentId: currentAgentId,
          },
        })
      }
    }

    const initialContext = await loadInitialContext(tx, workOrderId)

    const adv = await advanceWorkflowTx(
      tx,
      {
        workOrderId,
        workflowId,
        currentStageIndex: stageIndex,
        operationId,
        iterationCount: operation.iterationCount,
        initialContext,
        currentAgentId,
      },
      result
    )

    return {
      ...adv,
      workOrderId,
      workflowId,
      workOrderCode: operation.workOrder.code,
      workOrderTitle: operation.workOrder.title,
      workOrderGoalMd: operation.workOrder.goalMd,
    }
  })

  if (advance.nextAction === 'escalate' && advance.escalationMessage) {
    try {
      const ceoSessionKey = await getCeoSessionKey()
      await sendToSession(ceoSessionKey, advance.escalationMessage)
    } catch (err) {
      await prisma.activity.create({
        data: {
          type: 'manager.notify_ceo_failed',
          actor: MANAGER_ACTIVITY_ACTOR,
          actorType: 'system',
          actorAgentId: null,
          entityType: 'work_order',
          entityId: advance.workOrderId,
          summary: 'Failed to notify CEO (escalation)',
          payloadJson: JSON.stringify({
            workflowId: advance.workflowId,
            error: err instanceof Error ? err.message : String(err),
          }),
        },
      })
    }
    return
  }

  if (advance.nextAction === 'complete') {
    const message = [
      `Work Order Complete: ${advance.workOrderCode}`,
      '',
      advance.workOrderTitle,
      '',
      `Workflow: ${advance.workflowId}`,
    ].join('\n')

    try {
      const ceoSessionKey = await getCeoSessionKey()
      await sendToSession(ceoSessionKey, message)
    } catch (err) {
      await prisma.activity.create({
        data: {
          type: 'manager.notify_ceo_failed',
          actor: MANAGER_ACTIVITY_ACTOR,
          actorType: 'system',
          actorAgentId: null,
          entityType: 'work_order',
          entityId: advance.workOrderId,
          summary: 'Failed to notify CEO (completion)',
          payloadJson: JSON.stringify({
            workflowId: advance.workflowId,
            error: err instanceof Error ? err.message : String(err),
          }),
        },
      })
    }

    await prisma.activity.create({
      data: {
        type: 'manager.notify_ceo',
        actor: MANAGER_ACTIVITY_ACTOR,
        actorType: 'system',
        actorAgentId: null,
        entityType: 'work_order',
        entityId: advance.workOrderId,
        summary: 'Notified CEO: completed',
        payloadJson: JSON.stringify({
          workflowId: advance.workflowId,
        }),
      },
    })

    return
  }

  if (
    (advance.nextAction === 'continue' || advance.nextAction === 'loop') &&
    advance.nextOperationId &&
    advance.nextAgentId
  ) {
    const nextOp = await prisma.operation.findUnique({
      where: { id: advance.nextOperationId },
      include: { workOrder: true },
    })

    if (!nextOp) return

    const task = [nextOp.workOrder.goalMd ?? '', '', nextOp.notes ? '---\nRework / Notes:\n' + nextOp.notes : '']
      .filter(Boolean)
      .join('\n')

    try {
      const spawned = await dispatchToAgent({
        agentId: advance.nextAgentId,
        workOrderId: nextOp.workOrderId,
        operationId: nextOp.id,
        task,
        context: {
          workOrderId: nextOp.workOrderId,
          operationId: nextOp.id,
          workflowId: nextOp.workflowId,
          stageIndex: nextOp.workflowStageIndex,
          iterationCount: nextOp.iterationCount,
          agentId: advance.nextAgentId,
          agentName: advance.nextAgentName ?? undefined,
        },
      })

      await prisma.operation.update({
        where: { id: nextOp.id },
        data: { status: 'in_progress' },
      })

      await prisma.activity.create({
        data: {
          type: 'workflow.dispatched',
          actor: MANAGER_ACTIVITY_ACTOR,
          actorType: 'system',
          actorAgentId: null,
          entityType: 'operation',
          entityId: nextOp.id,
          summary: `Dispatched ${advance.nextAgentName ?? advance.nextAgentId} for stage ${Number(nextOp.workflowStageIndex) + 1}`,
          payloadJson: JSON.stringify({
            workflowId: advance.workflowId,
            stageIndex: nextOp.workflowStageIndex,
            agentId: advance.nextAgentId,
            agentName: advance.nextAgentName ?? null,
            sessionKey: spawned.sessionKey,
            sessionId: spawned.sessionId,
          }),
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      await prisma.operation.update({
        where: { id: nextOp.id },
        data: { status: 'blocked', blockedReason: message },
      })

      await prisma.activity.create({
        data: {
          type: 'workflow.dispatch_failed',
          actor: MANAGER_ACTIVITY_ACTOR,
          actorType: 'system',
          actorAgentId: null,
          entityType: 'operation',
          entityId: nextOp.id,
          summary: `Dispatch failed for ${advance.nextAgentName ?? advance.nextAgentId}`,
          payloadJson: JSON.stringify({
            workflowId: advance.workflowId,
            stageIndex: nextOp.workflowStageIndex,
            agentId: advance.nextAgentId,
            agentName: advance.nextAgentName ?? null,
            error: message,
          }),
        },
      })
    }
  }
}
