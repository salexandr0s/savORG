import { NextRequest, NextResponse } from 'next/server'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'
import { getWorkflowDefinition } from '@/lib/workflows/registry'
import {
  deleteCustomWorkflow,
  getWorkflowUsageStats,
  updateCustomWorkflow,
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

export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const definition = await getWorkflowDefinition(id, { forceReload: true })

  if (!definition) {
    return NextResponse.json({ error: 'Workflow not found', code: 'WORKFLOW_NOT_FOUND' }, { status: 404 })
  }

  const usage = await getWorkflowUsageStats(id)

  return NextResponse.json({
    data: {
      id: definition.id,
      source: definition.source,
      editable: definition.editable,
      sourcePath: definition.sourcePath,
      updatedAt: definition.updatedAt,
      stages: definition.stages,
      loops: definition.loops,
      usage,
      workflow: definition.workflow,
    },
  })
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = (await request.json().catch(() => null)) as {
    workflow?: unknown
    typedConfirmText?: string
  } | null

  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'workflow.edit',
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
    const workflow = await updateCustomWorkflow(id, body.workflow)
    return NextResponse.json({ data: workflow })
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
      { error: error instanceof Error ? error.message : 'Failed to update workflow' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = (await request.json().catch(() => ({}))) as {
    typedConfirmText?: string
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'workflow.delete',
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
    await deleteCustomWorkflow(id)
    return NextResponse.json({ success: true })
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
      { error: error instanceof Error ? error.message : 'Failed to delete workflow' },
      { status: 500 }
    )
  }
}
