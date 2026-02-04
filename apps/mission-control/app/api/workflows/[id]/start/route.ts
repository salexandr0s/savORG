import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { WORKFLOWS } from '@/lib/workflows/definitions'
import { initiateWorkflow } from '@/lib/services/manager'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  let body: { workOrderId?: string; context?: Record<string, unknown> }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const workflowId = params.id
  if (!WORKFLOWS[workflowId]) {
    return NextResponse.json({ error: `Unknown workflow: ${workflowId}` }, { status: 404 })
  }

  const workOrderId = body.workOrderId
  if (!workOrderId) {
    return NextResponse.json({ error: 'Missing workOrderId' }, { status: 400 })
  }

  const workOrder = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
  })

  if (!workOrder) {
    return NextResponse.json({ error: 'Work order not found' }, { status: 404 })
  }

  const started = await initiateWorkflow(workOrderId, workflowId, body.context ?? {})

  return NextResponse.json({
    success: true,
    workflowId,
    workOrderId,
    operationId: started.operationId,
    agentName: started.agentName,
    sessionKey: started.sessionKey,
  })
}

