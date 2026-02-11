import { NextResponse } from 'next/server'
import { startManagedWorkOrder } from '@/lib/services/manager'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'

type StartBody = {
  context?: Record<string, unknown>
  force?: boolean
  workflowId?: string
}

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * POST /api/work-orders/:id/start
 *
 * Canonical manager-engine start endpoint.
 */
export async function POST(request: Request, context: RouteContext) {
  const { id: workOrderId } = await context.params
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  let body: StartBody = {}
  try {
    body = (await request.json()) as StartBody
  } catch {
    // empty body is allowed
  }

  try {
    const started = await startManagedWorkOrder(workOrderId, {
      context: body.context,
      force: Boolean(body.force),
      workflowIdOverride: body.workflowId,
    })

    return NextResponse.json({
      success: true,
      workOrderId: started.workOrderId,
      workflowId: started.workflowId,
      operationId: started.operationId,
      stageIndex: started.stageIndex,
      agentId: started.agentId,
      agentName: started.agentName,
      sessionKey: started.sessionKey,
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to start work order',
      },
      { status: 400 }
    )
  }
}
