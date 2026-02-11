import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { prisma } from '@/lib/db'
import { resumeManagedWorkOrder } from '@/lib/services/manager'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/approvals/:id
 *
 * Get a single approval
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  try {
    const repos = getRepos()
    const data = await repos.approvals.getById(id)

    if (!data) {
      return NextResponse.json(
        { error: 'Approval not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/approvals/:id] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch approval' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/approvals/:id
 *
 * Approve or reject an approval with activity logging.
 * Danger actions require a note when rejecting.
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  try {
    const auth = verifyOperatorRequest(request, { requireCsrf: true })
    if (!auth.ok) {
      return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
    }

    const body = await request.json()
    const { status, note } = body

    if (!status || !['approved', 'rejected'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be "approved" or "rejected"' },
        { status: 400 }
      )
    }

    const repos = getRepos()

    // Get the current approval first for activity logging
    const current = await repos.approvals.getById(id)
    if (!current) {
      return NextResponse.json(
        { error: 'Approval not found' },
        { status: 404 }
      )
    }

    // Check if already resolved (idempotent - return current state)
    if (current.status !== 'pending') {
      return NextResponse.json({ data: current })
    }

    // For danger rejections, require a note
    // (risky_action type is typically danger level)
    if (status === 'rejected' && current.type === 'risky_action' && !note) {
      return NextResponse.json(
        { error: 'A note is required when rejecting danger-level actions' },
        { status: 400 }
      )
    }

    // Update the approval
    const data = await repos.approvals.update(id, {
      status,
      resolvedBy: auth.principal.actor,
    })

    if (!data) {
      return NextResponse.json(
        { error: 'Failed to update approval' },
        { status: 500 }
      )
    }

    // Write activity record for the approval itself
    await repos.activities.create({
      type: `approval.${status}`,
      actor: auth.principal.actor,
      entityType: 'approval',
      entityId: id,
      summary: `Approval ${status}: "${current.questionMd.substring(0, 50)}${current.questionMd.length > 50 ? '...' : ''}"`,
      payloadJson: {
        workOrderId: data.workOrderId,
        operationId: data.operationId,
        approvalType: data.type,
        status,
        note: note || null,
      },
    })

    // Also write activity for the work order
    await repos.activities.create({
      type: `work_order.approval_${status}`,
      actor: auth.principal.actor,
      entityType: 'work_order',
      entityId: data.workOrderId,
      summary: `Approval ${status} for ${data.type.replace(/_/g, ' ')}${note ? `: ${note}` : ''}`,
      payloadJson: {
        approvalId: id,
        approvalType: data.type,
        status,
        note: note || null,
      },
    })

    const shouldAutoResume =
      status === 'approved' &&
      Boolean(current.operationId) &&
      (current.type === 'risky_action' || current.type === 'scope_change')

    if (shouldAutoResume && current.operationId) {
      const operation = await prisma.operation.findUnique({
        where: { id: current.operationId },
        select: {
          id: true,
          workflowId: true,
          escalationReason: true,
          blockedReason: true,
          escalatedAt: true,
        },
      })

      const isSecurityVeto =
        operation?.escalationReason === 'security_veto'
        || (operation?.blockedReason ?? '').toLowerCase().includes('security_veto')
      const isEscalationApproval = Boolean(operation?.escalatedAt)

      if (operation?.workflowId && isEscalationApproval && !isSecurityVeto) {
        try {
          const resumed = await resumeManagedWorkOrder(data.workOrderId, {
            reason: `approval:${id}`,
          })

          await repos.activities.create({
            type: 'workflow.auto_resumed',
            actor: 'system:manager',
            actorType: 'system',
            entityType: 'work_order',
            entityId: data.workOrderId,
            summary: resumed
              ? `Auto-resumed workflow from approval ${id}`
              : `Approval ${id} resolved; no resume candidate found`,
            payloadJson: {
              approvalId: id,
              operationId: current.operationId,
              isEscalationApproval,
              skippedForSecurityVeto: isSecurityVeto,
              resumed: Boolean(resumed),
              resumedOperationId: resumed?.operationId ?? null,
            },
          })
        } catch (resumeError) {
          await repos.activities.create({
            type: 'workflow.auto_resume_failed',
            actor: 'system:manager',
            actorType: 'system',
            entityType: 'work_order',
            entityId: data.workOrderId,
            summary: `Failed to auto-resume workflow after approval ${id}`,
            payloadJson: {
              approvalId: id,
              operationId: current.operationId,
              error: resumeError instanceof Error ? resumeError.message : String(resumeError),
            },
          })
        }
      }
    }

    return NextResponse.json({ data })
  } catch (error) {
    console.error('[api/approvals/:id] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update approval' },
      { status: 500 }
    )
  }
}
