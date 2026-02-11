import { NextResponse } from 'next/server'
import { advanceOnCompletion } from '@/lib/services/workflow-engine'
import { asAuthErrorResponse, verifyInternalToken } from '@/lib/auth/operator-auth'

type CompletionBody = {
  operationId?: string
  status?: 'approved' | 'rejected' | 'vetoed' | 'completed'
  output?: unknown
  feedback?: string
  artifacts?: string[]
  completionToken?: string
}

export async function POST(request: Request) {
  const auth = verifyInternalToken(request)
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  let body: CompletionBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.operationId || typeof body.operationId !== 'string') {
    return NextResponse.json({ error: 'Missing operationId' }, { status: 400 })
  }

  if (!body.status) {
    return NextResponse.json({ error: 'Missing status' }, { status: 400 })
  }

  const allowed = new Set(['approved', 'rejected', 'vetoed', 'completed'])
  if (!allowed.has(body.status)) {
    return NextResponse.json({ error: `Invalid status: ${body.status}` }, { status: 400 })
  }

  const completed = await advanceOnCompletion(body.operationId, {
    status: body.status,
    output: body.output,
    feedback: body.feedback,
    artifacts: body.artifacts,
  }, {
    completionToken: body.completionToken,
  })

  return NextResponse.json({
    success: true,
    duplicate: completed.duplicate,
    noop: completed.noop,
    code: completed.code ?? null,
    reason: completed.reason ?? null,
  })
}
