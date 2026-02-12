import { NextRequest, NextResponse } from 'next/server'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'
import {
  cloneWorkflow,
  type WorkflowServiceError,
} from '@/lib/workflows/service'

interface RouteContext {
  params: Promise<{ id: string }>
}

function asWorkflowError(error: unknown): WorkflowServiceError | null {
  if (error instanceof Error && error.name === 'WorkflowServiceError') {
    return error as WorkflowServiceError
  }
  return null
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = (await request.json().catch(() => ({}))) as {
    cloneId?: string
    descriptionSuffix?: string
    typedConfirmText?: string
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'workflow.clone',
    typedConfirmText: body.typedConfirmText,
  })

  if (!enforcement.allowed) {
    return NextResponse.json(
      {
        error: enforcement.errorType,
        policy: enforcement.policy,
      },
      { status: enforcement.status ?? 403 }
    )
  }

  try {
    const cloned = await cloneWorkflow({
      workflowId: id,
      cloneId: body.cloneId,
      descriptionSuffix: body.descriptionSuffix,
    })

    return NextResponse.json({ data: cloned }, { status: 201 })
  } catch (error) {
    const workflowError = asWorkflowError(error)
    if (workflowError) {
      return NextResponse.json(
        {
          error: workflowError.message,
          code: workflowError.code,
          details: workflowError.details,
        },
        { status: workflowError.status }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to clone workflow' },
      { status: 500 }
    )
  }
}
