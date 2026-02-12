import 'server-only'

import { prisma } from '@/lib/db'
import { getRepos } from '@/lib/repo'
import { normalizeOwnerRef, ownerToActor } from '@/lib/agent-identity'
import { selectWorkflowForWorkOrder } from '@/lib/workflows/registry'
import { startManagedWorkOrder } from '@/lib/services/manager'
import { classifyErrorSignature } from './error-classifier'
import { getErrorSummary, dayStart } from './error-sync'

export type ErrorRemediationMode = 'create' | 'create_and_start'

export interface ErrorRemediationResult {
  workOrderId: string
  code: string
  mode: ErrorRemediationMode
  started: boolean
  operationId: string | null
  workflowId: string | null
  startError: string | null
}

function dateRangeFromDays(days: number): { from: Date; to: Date } {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.min(90, Math.floor(days))) : 14
  const toDay = dayStart(new Date())
  const from = new Date(toDay)
  from.setUTCDate(from.getUTCDate() - safeDays + 1)
  return { from, to: new Date(toDay.getTime() + 86400_000 - 1) }
}

function toIntSafe(input: string): number {
  const n = Number(input)
  return Number.isFinite(n) ? n : 0
}

function mapPriority(input: {
  severity: 'critical' | 'high' | 'medium' | 'low'
  actionable: boolean
  windowCount: number
  spikeDetected: boolean
}): 'P0' | 'P1' | 'P2' {
  if (input.severity === 'critical') return 'P0'
  if (input.spikeDetected && input.windowCount >= 10) return 'P0'
  if (input.windowCount >= 500) return 'P0'

  if (input.severity === 'high') return 'P1'
  if (input.actionable && input.windowCount >= 25) return 'P1'

  return 'P2'
}

function formatSuggestedActions(classification: ReturnType<typeof classifyErrorSignature>): string {
  if (classification.suggestedActions.length === 0) return '- None available'

  return classification.suggestedActions
    .map((action) => {
      const target = action.maintenanceAction
        ? `maintenance:${action.maintenanceAction}`
        : action.command
          ? `cli:${action.command}`
          : action.kind

      return `- **${action.label}** (${target})\n  ${action.description}`
    })
    .join('\n')
}

function buildGoalMarkdown(input: {
  signatureHash: string
  signatureText: string
  windowCount: string
  allTimeCount: string
  firstSeen: string
  lastSeen: string
  sample: string
  rawRedactedSample: string
  classification: ReturnType<typeof classifyErrorSignature>
  insightMd: string
  spikeDetected: boolean
  spikeBaseline: number
  spikeYesterdayCount: number
}): string {
  const evidence = input.rawRedactedSample || input.sample || 'No evidence sample captured.'

  return [
    '## Error Signature',
    `- Hash: \`${input.signatureHash}\``,
    `- Signature: ${input.signatureText}`,
    `- Category: ${input.classification.category}`,
    `- Severity: ${input.classification.severity}`,
    `- Detectability: ${input.classification.detectability} (${Math.round(input.classification.confidence * 100)}%)`,
    `- Window count (14d): ${input.windowCount}`,
    `- All-time count: ${input.allTimeCount}`,
    `- First seen: ${input.firstSeen}`,
    `- Last seen: ${input.lastSeen}`,
    `- Spike detected: ${input.spikeDetected ? 'yes' : 'no'} (yesterday=${input.spikeYesterdayCount}, baseline=${input.spikeBaseline})`,
    '',
    '## Evidence (Redacted)',
    '```text',
    evidence,
    '```',
    '',
    '## AI Diagnosis',
    input.insightMd || 'AI diagnosis unavailable. Use deterministic suggestions and logs for manual triage.',
    '',
    '## Suggested Actions',
    formatSuggestedActions(input.classification),
    '',
    '## Acceptance Criteria',
    '- Root cause is identified and documented in receipts.',
    '- A concrete fix is applied (maintenance action, config change, or code update).',
    '- Related gateway errors for this signature trend downward over the next 24h.',
    '- Validation checks are run and attached (health check, doctor, or targeted command output).',
  ].join('\n')
}

export async function createErrorRemediationWorkOrder(
  signatureHash: string,
  mode: ErrorRemediationMode
): Promise<ErrorRemediationResult> {
  const signature = await prisma.errorSignatureAggregate.findUnique({
    where: { signatureHash },
  })

  if (!signature) {
    throw new Error(`Unknown error signature: ${signatureHash}`)
  }

  const { from, to } = dateRangeFromDays(14)
  const windowAgg = await prisma.errorSignatureDailyAggregate.aggregate({
    where: {
      signatureHash,
      day: {
        gte: from,
        lte: to,
      },
    },
    _sum: { count: true },
  })

  const insight = await prisma.errorSignatureInsight.findUnique({
    where: { signatureHash },
  })

  const classification = classifyErrorSignature({
    signatureText: signature.signatureText,
    sample: signature.lastSampleSanitized,
    sampleRawRedacted: signature.lastSampleRawRedacted,
  })

  const summary = await getErrorSummary(14)
  const windowCount = (windowAgg._sum.count ?? 0n).toString()
  const priority = mapPriority({
    severity: classification.severity,
    actionable: classification.actionable,
    windowCount: toIntSafe(windowCount),
    spikeDetected: summary.spike.detected,
  })

  const tags = Array.from(new Set([
    'bug',
    'incident',
    'gateway-error',
    `signature:${signatureHash}`,
    `category:${classification.category}`,
  ]))

  const title = `Remediate gateway error ${signatureHash.slice(0, 8)} (${classification.category})`

  const insightMd = insight?.status === 'ready' && insight.diagnosisMd.trim().length > 0
    ? insight.diagnosisMd.trim()
    : `Deterministic diagnosis: ${classification.explanation}`

  const goalMd = buildGoalMarkdown({
    signatureHash,
    signatureText: signature.signatureText,
    windowCount,
    allTimeCount: signature.count.toString(),
    firstSeen: signature.firstSeenAt.toISOString(),
    lastSeen: signature.lastSeenAt.toISOString(),
    sample: signature.lastSampleSanitized,
    rawRedactedSample: signature.lastSampleRawRedacted,
    classification,
    insightMd,
    spikeDetected: summary.spike.detected,
    spikeBaseline: summary.spike.baseline,
    spikeYesterdayCount: summary.spike.yesterdayCount,
  })

  const normalizedOwner = normalizeOwnerRef({ owner: 'user' })
  const selectedWorkflow = await selectWorkflowForWorkOrder({
    requestedWorkflowId: null,
    priority,
    title,
    goalMd,
    tags,
  })

  const repos = getRepos()
  const workOrder = await repos.workOrders.create({
    title,
    goalMd,
    priority,
    owner: normalizedOwner.owner,
    ownerType: normalizedOwner.ownerType,
    ownerAgentId: normalizedOwner.ownerAgentId,
    tags,
    workflowId: selectedWorkflow.workflowId,
  })

  await repos.activities.create({
    type: 'work_order.created',
    actor: ownerToActor(normalizedOwner.owner, normalizedOwner.ownerType, normalizedOwner.ownerAgentId),
    actorType: normalizedOwner.ownerType,
    actorAgentId: normalizedOwner.ownerAgentId,
    entityType: 'work_order',
    entityId: workOrder.id,
    summary: `Work order ${workOrder.code} created: ${title}`,
    payloadJson: {
      code: workOrder.code,
      title,
      priority,
      owner: normalizedOwner.owner,
      ownerType: normalizedOwner.ownerType,
      ownerAgentId: normalizedOwner.ownerAgentId,
      tags: workOrder.tags,
      state: workOrder.state,
      workflowId: workOrder.workflowId,
      source: 'error-remediation',
      signatureHash,
    },
  })

  await repos.activities.create({
    type: 'errors.remediation_work_order_created',
    actor: 'user:operator',
    actorType: 'user',
    entityType: 'error_signature',
    entityId: signatureHash,
    summary: `Created remediation work order ${workOrder.code} for signature ${signatureHash.slice(0, 8)}`,
    payloadJson: {
      workOrderId: workOrder.id,
      code: workOrder.code,
      mode,
      priority,
      category: classification.category,
      severity: classification.severity,
      signatureHash,
      workflowId: workOrder.workflowId,
    },
  })

  if (mode === 'create') {
    return {
      workOrderId: workOrder.id,
      code: workOrder.code,
      mode,
      started: false,
      operationId: null,
      workflowId: workOrder.workflowId ?? null,
      startError: null,
    }
  }

  try {
    const started = await startManagedWorkOrder(workOrder.id, {
      context: {
        source: 'error_remediation',
        signatureHash,
      },
      force: false,
      workflowIdOverride: workOrder.workflowId ?? undefined,
    })

    await repos.activities.create({
      type: 'errors.remediation_started',
      actor: 'user:operator',
      actorType: 'user',
      entityType: 'error_signature',
      entityId: signatureHash,
      summary: `Started remediation work order ${workOrder.code}`,
      payloadJson: {
        workOrderId: workOrder.id,
        code: workOrder.code,
        operationId: started.operationId,
        workflowId: started.workflowId,
        agentId: started.agentId,
        agentName: started.agentName,
      },
    })

    return {
      workOrderId: workOrder.id,
      code: workOrder.code,
      mode,
      started: true,
      operationId: started.operationId,
      workflowId: started.workflowId,
      startError: null,
    }
  } catch (error) {
    const startError = error instanceof Error ? error.message : 'Failed to start remediation workflow'

    await repos.activities.create({
      type: 'errors.remediation_start_failed',
      actor: 'user:operator',
      actorType: 'user',
      entityType: 'error_signature',
      entityId: signatureHash,
      summary: `Remediation auto-start failed for work order ${workOrder.code}`,
      payloadJson: {
        workOrderId: workOrder.id,
        code: workOrder.code,
        error: startError,
      },
    })

    return {
      workOrderId: workOrder.id,
      code: workOrder.code,
      mode,
      started: false,
      operationId: null,
      workflowId: workOrder.workflowId ?? null,
      startError,
    }
  }
}
