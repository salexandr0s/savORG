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

const CEO_SESSION_KEY = 'agent:clawcontrolceo:main'

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

export async function initiateWorkflow(
  workOrderId: string,
  workflowId: string,
  initialContext: Record<string, unknown> = {}
): Promise<{ operationId: string; agentName: string; sessionKey: string | null }> {
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
        actor: 'agent:clawcontrolmanager',
        entityType: 'work_order',
        entityId: workOrderId,
        summary: `Started workflow: ${workflowId}`,
        payloadJson: JSON.stringify({
          workflowId,
          startIndex,
          firstAgent: firstStage.agent,
          initialContext,
        }),
      },
    })

    const op = await tx.operation.create({
      data: {
        workOrderId,
        station: mapAgentToStation(firstStage.agent),
        title: `${firstStage.agent} — Stage ${startIndex + 1}/${workflow.stages.length}`,
        status: 'todo',
        workflowId,
        workflowStageIndex: startIndex,
        iterationCount: 0,
        assigneeAgentIds: JSON.stringify([firstStage.agent]),
      },
    })

    return { operationId: op.id }
  })

  const workOrder = await prisma.workOrder.findUnique({ where: { id: workOrderId } })
  if (!workOrder) throw new Error(`Work order not found: ${workOrderId}`)

  try {
    const spawned = await dispatchToAgent({
      agentName: firstStage.agent,
      workOrderId,
      operationId,
      task: workOrder.goalMd ?? '',
      context: {
        workOrderId,
        operationId,
        workflowId,
        stageIndex: startIndex,
        initialContext,
      },
    })

    await prisma.operation.update({
      where: { id: operationId },
      data: { status: 'in_progress' },
    })

    await prisma.activity.create({
      data: {
        type: 'workflow.dispatched',
        actor: 'agent:clawcontrolmanager',
        entityType: 'operation',
        entityId: operationId,
        summary: `Dispatched ${firstStage.agent} for stage ${startIndex + 1}`,
        payloadJson: JSON.stringify({
          workflowId,
          stageIndex: startIndex,
          agent: firstStage.agent,
          sessionKey: spawned.sessionKey,
          sessionId: spawned.sessionId,
        }),
      },
    })

    return { operationId, agentName: firstStage.agent, sessionKey: spawned.sessionKey }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Dispatch failed'

    await prisma.operation.update({
      where: { id: operationId },
      data: { status: 'blocked', blockedReason: message },
    })

    await prisma.activity.create({
      data: {
        type: 'workflow.dispatch_failed',
        actor: 'agent:clawcontrolmanager',
        entityType: 'operation',
        entityId: operationId,
        summary: `Dispatch failed for ${firstStage.agent}`,
        payloadJson: JSON.stringify({
          workflowId,
          stageIndex: startIndex,
          agent: firstStage.agent,
          error: message,
        }),
      },
    })

    return { operationId, agentName: firstStage.agent, sessionKey: null }
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
    const agentName = stage?.agent ?? 'unknown'

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
        commandName: `agent:${agentName}`,
        commandArgsJson: JSON.stringify({
          workflowId,
          stageIndex,
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
            createdBy: agentName,
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
      await sendToSession(CEO_SESSION_KEY, advance.escalationMessage)
    } catch (err) {
      await prisma.activity.create({
        data: {
          type: 'manager.notify_ceo_failed',
          actor: 'agent:clawcontrolmanager',
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
      await sendToSession(CEO_SESSION_KEY, message)
    } catch (err) {
      await prisma.activity.create({
        data: {
          type: 'manager.notify_ceo_failed',
          actor: 'agent:clawcontrolmanager',
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
        actor: 'agent:clawcontrolmanager',
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
    advance.nextAgentName
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
        agentName: advance.nextAgentName,
        workOrderId: nextOp.workOrderId,
        operationId: nextOp.id,
        task,
        context: {
          workOrderId: nextOp.workOrderId,
          operationId: nextOp.id,
          workflowId: nextOp.workflowId,
          stageIndex: nextOp.workflowStageIndex,
          iterationCount: nextOp.iterationCount,
        },
      })

      await prisma.operation.update({
        where: { id: nextOp.id },
        data: { status: 'in_progress' },
      })

      await prisma.activity.create({
        data: {
          type: 'workflow.dispatched',
          actor: 'agent:clawcontrolmanager',
          entityType: 'operation',
          entityId: nextOp.id,
          summary: `Dispatched ${advance.nextAgentName} for stage ${Number(nextOp.workflowStageIndex) + 1}`,
          payloadJson: JSON.stringify({
            workflowId: advance.workflowId,
            stageIndex: nextOp.workflowStageIndex,
            agent: advance.nextAgentName,
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
          actor: 'agent:clawcontrolmanager',
          entityType: 'operation',
          entityId: nextOp.id,
          summary: `Dispatch failed for ${advance.nextAgentName}`,
          payloadJson: JSON.stringify({
            workflowId: advance.workflowId,
            stageIndex: nextOp.workflowStageIndex,
            agent: advance.nextAgentName,
            error: message,
          }),
        },
      })
    }
  }
}

