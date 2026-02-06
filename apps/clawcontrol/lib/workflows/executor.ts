import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '../db'
import { spawnAgentSession } from '../openclaw/sessions'
import { WORKFLOWS } from './definitions'
import { extractAgentIdFromSessionKey } from '../agent-identity'
import { resolveWorkflowStageAgent } from '../services/agent-resolution'

export type WorkflowNextAction = 'continue' | 'loop' | 'escalate' | 'complete'

export interface ExecutionContext {
  workOrderId: string
  workflowId: string
  currentStageIndex: number
  operationId: string
  iterationCount: number
  initialContext: Record<string, unknown>
  currentAgentId?: string | null
}

export interface StageResult {
  status: 'approved' | 'rejected' | 'vetoed' | 'completed'
  output: unknown
  feedback?: string
  artifacts?: string[]
}

export interface AdvanceWorkflowTxResult {
  nextAction: WorkflowNextAction
  nextOperationId?: string
  nextAgentId?: string
  nextAgentName?: string
  nextStageIndex?: number
  escalationMessage?: string
}

/**
 * Spawns an agent session with the required session key convention:
 * `agent:<runtimeAgentId>:wo:<workOrderId>:op:<operationId>`
 */
export async function dispatchToAgent(input: {
  agentId: string
  workOrderId: string
  operationId: string
  task: string
  context?: Record<string, unknown>
}): Promise<{ sessionKey: string; sessionId: string | null }> {
  const agent = await prisma.agent.findUnique({
    where: { id: input.agentId },
    select: {
      id: true,
      slug: true,
      runtimeAgentId: true,
      sessionKey: true,
      model: true,
      status: true,
    },
  })
  if (!agent) {
    throw new Error(`Agent not found: ${input.agentId}`)
  }

  const runtimeAgentId =
    agent.runtimeAgentId?.trim() ||
    extractAgentIdFromSessionKey(agent.sessionKey) ||
    agent.slug?.trim() ||
    agent.id

  const sessionKey = `agent:${runtimeAgentId}:wo:${input.workOrderId}:op:${input.operationId}`

  const result = await spawnAgentSession({
    agentId: runtimeAgentId,
    label: sessionKey,
    task: input.task,
    context: input.context ?? {},
    model: agent.model ?? undefined,
  })

  // Best-effort status update (telemetry-only)
  await prisma.agent
    .update({
      where: { id: agent.id },
      data: { status: 'active', lastSeenAt: new Date() },
    })
    .catch(() => {})

  return result
}

export function mapAgentToStation(agent: { station?: string | null } | string): string {
  if (typeof agent === 'string') {
    const normalized = agent.trim().toLowerCase()
    return normalized || 'build'
  }

  const station = (agent.station ?? '').trim().toLowerCase()
  return station || 'build'
}

export function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  switch (condition) {
    case 'unknowns_exist':
      return Boolean((context as { hasUnknowns?: unknown }).hasUnknowns)
    case 'deployment_needed':
      return Boolean((context as { needsDeployment?: unknown }).needsDeployment)
    case 'security_relevant':
      return Boolean((context as { touchesSecurity?: unknown }).touchesSecurity)
    case 'code_review_needed':
      return Boolean((context as { hasCodeChanges?: unknown }).hasCodeChanges)
    default:
      return true
  }
}

export async function advanceWorkflowTx(
  tx: Prisma.TransactionClient,
  ctx: ExecutionContext,
  result: StageResult
): Promise<AdvanceWorkflowTxResult> {
  const workflow = WORKFLOWS[ctx.workflowId]
  if (!workflow) throw new Error(`Unknown workflow: ${ctx.workflowId}`)

  const currentStage = workflow.stages[ctx.currentStageIndex]
  if (!currentStage) {
    throw new Error(`Workflow stage out of range: ${ctx.workflowId} idx=${ctx.currentStageIndex}`)
  }

  const actorAgentId = ctx.currentAgentId ?? null
  const actor = actorAgentId ? `agent:${actorAgentId}` : 'system'
  const actorType = actorAgentId ? 'agent' : 'system'

  // Handle veto
  if (result.status === 'vetoed' && currentStage.canVeto) {
    const escalationMessage = buildEscalationMessage(ctx, 'security_veto', result)

    await tx.operation.update({
      where: { id: ctx.operationId },
      data: {
        status: 'blocked',
        escalatedAt: new Date(),
        escalationReason: 'security_veto',
        blockedReason: result.feedback ?? 'security_veto',
      },
    })

    await tx.workOrder.update({
      where: { id: ctx.workOrderId },
      data: {
        state: 'blocked',
        blockedReason: result.feedback ?? 'security_veto',
      },
    })

    await tx.approval.create({
      data: {
        workOrderId: ctx.workOrderId,
        operationId: ctx.operationId,
        type: 'risky_action',
        questionMd: escalationMessage,
        status: 'pending',
      },
    })

    await tx.activity.create({
      data: {
        type: 'escalation.security_veto',
        actor,
        actorType,
        actorAgentId,
        entityType: 'operation',
        entityId: ctx.operationId,
        summary: 'Escalated to CEO: security_veto',
        payloadJson: JSON.stringify({
          workflowId: ctx.workflowId,
          stageIndex: ctx.currentStageIndex,
          feedback: result.feedback ?? null,
        }),
      },
    })

    return { nextAction: 'escalate', escalationMessage }
  }

  // Handle rejection with loop
  if (result.status === 'rejected' && currentStage.loopTarget) {
    const maxIter = currentStage.maxIterations ?? 2

    if (ctx.iterationCount >= maxIter) {
      const escalationMessage = buildEscalationMessage(ctx, 'iteration_cap_exceeded', result)

      await tx.operation.update({
        where: { id: ctx.operationId },
        data: {
          status: 'blocked',
          escalatedAt: new Date(),
          escalationReason: 'iteration_cap_exceeded',
          blockedReason: result.feedback ?? 'iteration_cap_exceeded',
        },
      })

      await tx.workOrder.update({
        where: { id: ctx.workOrderId },
        data: {
          state: 'blocked',
          blockedReason: result.feedback ?? 'iteration_cap_exceeded',
        },
      })

      await tx.approval.create({
        data: {
          workOrderId: ctx.workOrderId,
          operationId: ctx.operationId,
          type: 'scope_change',
          questionMd: escalationMessage,
          status: 'pending',
        },
      })

      await tx.activity.create({
        data: {
          type: 'escalation.iteration_cap_exceeded',
          actor,
          actorType,
          actorAgentId,
          entityType: 'operation',
          entityId: ctx.operationId,
          summary: 'Escalated to CEO: iteration_cap_exceeded',
          payloadJson: JSON.stringify({
            workflowId: ctx.workflowId,
            stageIndex: ctx.currentStageIndex,
            iterationCount: ctx.iterationCount,
            maxIterations: maxIter,
            feedback: result.feedback ?? null,
          }),
        },
      })

      return { nextAction: 'escalate', escalationMessage }
    }

    const targetIndex = workflow.stages.findIndex((s) => s.agent === currentStage.loopTarget)
    if (targetIndex === -1) {
      throw new Error(`Loop target ${currentStage.loopTarget} not found in workflow ${ctx.workflowId}`)
    }

    const nextIteration = ctx.iterationCount + 1
    const loopTarget = currentStage.loopTarget
    const loopTargetAgent = await resolveWorkflowStageAgent(tx, loopTarget)
    if (!loopTargetAgent) {
      throw new Error(`No available agent for workflow stage: ${loopTarget}`)
    }

    const newOp = await tx.operation.create({
      data: {
        workOrderId: ctx.workOrderId,
        station: mapAgentToStation({ station: loopTargetAgent.station }),
        title: `[Rework] ${loopTargetAgent.displayName} (iteration ${nextIteration})`,
        notes: result.feedback ?? null,
        status: 'todo',
        workflowId: ctx.workflowId,
        workflowStageIndex: targetIndex,
        iterationCount: nextIteration,
        loopTargetOpId: ctx.operationId,
        assigneeAgentIds: JSON.stringify([loopTargetAgent.id]),
      },
    })

    await tx.workOrder.update({
      where: { id: ctx.workOrderId },
      data: { currentStage: targetIndex, state: 'active', blockedReason: null },
    })

    await tx.activity.create({
      data: {
        type: 'workflow.loop',
        actor: 'system',
        actorType: 'system',
        actorAgentId: null,
        entityType: 'operation',
        entityId: newOp.id,
        summary: `Looped back to ${loopTargetAgent.displayName} (iteration ${nextIteration})`,
        payloadJson: JSON.stringify({
          workflowId: ctx.workflowId,
          fromStageIndex: ctx.currentStageIndex,
          toStageIndex: targetIndex,
          stageRef: loopTarget,
          agentId: loopTargetAgent.id,
          agentName: loopTargetAgent.displayName,
          feedback: result.feedback ?? null,
          previousOpId: ctx.operationId,
        }),
      },
    })

    return {
      nextAction: 'loop',
      nextOperationId: newOp.id,
      nextAgentId: loopTargetAgent.id,
      nextAgentName: loopTargetAgent.displayName,
      nextStageIndex: targetIndex,
    }
  }

  // Move to next stage (skipping optional stages when condition is false)
  let nextIndex = ctx.currentStageIndex + 1
  while (nextIndex < workflow.stages.length) {
    const s = workflow.stages[nextIndex]
    if (s.optional && s.condition) {
      const conditionMet = evaluateCondition(s.condition, ctx.initialContext)
      if (!conditionMet) {
        await tx.activity.create({
          data: {
            type: 'workflow.stage_skipped',
            actor: 'system',
            actorType: 'system',
            actorAgentId: null,
            entityType: 'work_order',
            entityId: ctx.workOrderId,
            summary: `Skipped optional stage: ${s.agent} (${s.condition})`,
            payloadJson: JSON.stringify({
              workflowId: ctx.workflowId,
              stageIndex: nextIndex,
              stageRef: s.agent,
              condition: s.condition,
            }),
          },
        })
        nextIndex++
        continue
      }
    }
    break
  }

  if (nextIndex >= workflow.stages.length) {
    await tx.workOrder.update({
      where: { id: ctx.workOrderId },
      data: {
        state: 'shipped',
        shippedAt: new Date(),
        blockedReason: null,
      },
    })

    await tx.activity.create({
      data: {
        type: 'work_order.shipped',
        actor: 'system',
        actorType: 'system',
        actorAgentId: null,
        entityType: 'work_order',
        entityId: ctx.workOrderId,
        summary: 'Work order completed all workflow stages',
        payloadJson: JSON.stringify({
          workflowId: ctx.workflowId,
        }),
      },
    })

    return { nextAction: 'complete' }
  }

  const nextStage = workflow.stages[nextIndex]
  const nextStageAgent = await resolveWorkflowStageAgent(tx, nextStage.agent)
  if (!nextStageAgent) {
    throw new Error(`No available agent for workflow stage: ${nextStage.agent}`)
  }

  const newOp = await tx.operation.create({
    data: {
      workOrderId: ctx.workOrderId,
      station: mapAgentToStation({ station: nextStageAgent.station }),
      title: `${nextStageAgent.displayName} — Stage ${nextIndex + 1}/${workflow.stages.length}`,
      status: 'todo',
      workflowId: ctx.workflowId,
      workflowStageIndex: nextIndex,
      iterationCount: ctx.iterationCount,
      assigneeAgentIds: JSON.stringify([nextStageAgent.id]),
    },
  })

  await tx.workOrder.update({
    where: { id: ctx.workOrderId },
    data: { currentStage: nextIndex },
  })

  await tx.activity.create({
    data: {
      type: 'workflow.advanced',
      actor: 'system',
      actorType: 'system',
      actorAgentId: null,
      entityType: 'operation',
      entityId: newOp.id,
      summary: `Advanced to stage ${nextIndex + 1}/${workflow.stages.length} (${nextStageAgent.displayName})`,
      payloadJson: JSON.stringify({
        workflowId: ctx.workflowId,
        fromStageIndex: ctx.currentStageIndex,
        toStageIndex: nextIndex,
        stageRef: nextStage.agent,
        agentId: nextStageAgent.id,
        agentName: nextStageAgent.displayName,
      }),
    },
  })

  return {
    nextAction: 'continue',
    nextOperationId: newOp.id,
    nextAgentId: nextStageAgent.id,
    nextAgentName: nextStageAgent.displayName,
    nextStageIndex: nextIndex,
  }
}

export function buildEscalationMessage(
  ctx: ExecutionContext,
  reason: 'iteration_cap_exceeded' | 'security_veto',
  result: Pick<StageResult, 'feedback'>
): string {
  const workflow = WORKFLOWS[ctx.workflowId]
  const stage = workflow?.stages?.[ctx.currentStageIndex]

  const totalStages = workflow?.stages?.length ?? 0
  const stageLabel = stage ? `${stage.agent}` : 'unknown'
  const maxIterations = stage?.maxIterations ?? null

  const whatHappened =
    reason === 'iteration_cap_exceeded'
      ? `Review loop exceeded ${maxIterations ?? 'the configured'} iteration cap without approval.`
      : 'Security agent vetoed this change.'

  return [
    `## Escalation: ${reason}`,
    '',
    `**Work Order:** ${ctx.workOrderId}`,
    `**Workflow:** ${ctx.workflowId} → Stage ${ctx.currentStageIndex + 1}/${totalStages || '?'}`,
    `**Stage:** ${stageLabel}`,
    `**Iterations:** ${ctx.iterationCount}/${maxIterations ?? 'N/A'}`,
    '',
    '### Feedback',
    result.feedback ?? 'No feedback provided',
    '',
    '### Manager Summary',
    whatHappened,
    '',
    'Decision needed: approve rework scope, override veto, or cancel.',
  ].join('\n')
}
