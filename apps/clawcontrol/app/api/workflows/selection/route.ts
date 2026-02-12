import { NextRequest, NextResponse } from 'next/server'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'
import {
  clearWorkflowSelectionOverlay,
  getEffectiveWorkflowSelection,
  upsertWorkflowSelection,
  type WorkflowServiceError,
} from '@/lib/workflows/service'

function asWorkflowError(error: unknown): WorkflowServiceError | null {
  if (error instanceof Error && error.name === 'WorkflowServiceError') {
    return error as WorkflowServiceError
  }
  return null
}

export async function GET() {
  const selection = await getEffectiveWorkflowSelection()
  return NextResponse.json({
    data: {
      source: selection.source,
      selection: selection.selection,
    },
  })
}

export async function PUT(request: NextRequest) {
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = (await request.json().catch(() => null)) as {
    selection?: unknown
    typedConfirmText?: string
  } | null

  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'workflow.selection_update',
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
    const selection = await upsertWorkflowSelection(body.selection ?? body)
    return NextResponse.json({
      data: {
        source: 'custom',
        selection,
      },
    })
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
      { error: error instanceof Error ? error.message : 'Failed to update workflow selection' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = (await request.json().catch(() => ({}))) as {
    typedConfirmText?: string
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'workflow.selection_update',
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
    await clearWorkflowSelectionOverlay()
    const selection = await getEffectiveWorkflowSelection()
    return NextResponse.json({
      data: {
        source: selection.source,
        selection: selection.selection,
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to clear workflow selection override' },
      { status: 500 }
    )
  }
}
