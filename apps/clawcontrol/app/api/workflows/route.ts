import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'
import { listWorkflowDefinitions } from '@/lib/workflows/registry'
import {
  createCustomWorkflow,
  type WorkflowServiceError,
} from '@/lib/workflows/service'

function asWorkflowError(error: unknown): WorkflowServiceError | null {
  if (error instanceof Error && error.name === 'WorkflowServiceError') {
    return error as WorkflowServiceError
  }
  return null
}

async function buildUsageMap(ids: string[]): Promise<Map<string, number>> {
  const usageMap = new Map<string, number>()
  await Promise.all(
    ids.map(async (workflowId) => {
      const count = await prisma.workOrder.count({ where: { workflowId } })
      usageMap.set(workflowId, count)
    })
  )
  return usageMap
}

/**
 * GET /api/workflows
 * List available workflows (built-in + custom)
 */
export async function GET() {
  const definitions = await listWorkflowDefinitions()
  const usage = await buildUsageMap(definitions.map((item) => item.id))

  return NextResponse.json({
    data: definitions.map((item) => ({
      id: item.id,
      description: item.workflow.description,
      source: item.source,
      editable: item.editable,
      sourcePath: item.sourcePath,
      stages: item.stages,
      loops: item.loops,
      inUse: usage.get(item.id) ?? 0,
      updatedAt: item.updatedAt,
    })),
  })
}

/**
 * POST /api/workflows
 * Create a custom workflow in workspace /workflows
 */
export async function POST(request: NextRequest) {
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
    actionKind: 'workflow.create',
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
    const workflow = await createCustomWorkflow(body.workflow)
    return NextResponse.json({ data: workflow }, { status: 201 })
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
      { error: error instanceof Error ? error.message : 'Failed to create workflow' },
      { status: 500 }
    )
  }
}
