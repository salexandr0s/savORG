import { NextRequest, NextResponse } from 'next/server'
import yaml from 'js-yaml'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'
import { getWorkflowDefinition } from '@/lib/workflows/registry'

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params

  const auth = verifyOperatorRequest(request)
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const definition = await getWorkflowDefinition(id, { forceReload: true })
  if (!definition) {
    return NextResponse.json({ error: 'Workflow not found', code: 'WORKFLOW_NOT_FOUND' }, { status: 404 })
  }

  const typedConfirmText = request.nextUrl.searchParams.get('confirm') || undefined
  const enforcement = await enforceActionPolicy({
    actionKind: 'workflow.export',
    typedConfirmText,
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

  const content = yaml.dump(definition.workflow, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  })

  return new NextResponse(content.endsWith('\n') ? content : `${content}\n`, {
    headers: {
      'Content-Type': 'application/x-yaml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${definition.id}.workflow.yaml"`,
    },
  })
}
