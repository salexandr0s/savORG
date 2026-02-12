import { NextRequest, NextResponse } from 'next/server'
import type { ClawPackageKind } from '@clawcontrol/core'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'
import { buildPackageExport, PackageServiceError } from '@/lib/packages/service'

interface RouteContext {
  params: Promise<{ id: string }>
}

function parseKind(value: string | null): ClawPackageKind | null {
  if (
    value === 'agent_template'
    || value === 'agent_team'
    || value === 'workflow'
    || value === 'team_with_workflows'
  ) {
    return value
  }

  return null
}

/**
 * GET /api/packages/:id/export?kind=workflow|agent_template|agent_team|team_with_workflows
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = verifyOperatorRequest(request)
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const { id } = await context.params
  const kind = parseKind(request.nextUrl.searchParams.get('kind'))
  if (!kind) {
    return NextResponse.json(
      {
        error: 'kind query is required',
        details: {
          allowed: ['agent_template', 'agent_team', 'workflow', 'team_with_workflows'],
        },
      },
      { status: 400 }
    )
  }

  const typedConfirmText = request.nextUrl.searchParams.get('confirm') || undefined
  const enforcement = await enforceActionPolicy({
    actionKind: 'package.export',
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

  try {
    const exported = await buildPackageExport({ kind, id })

    return new NextResponse(new Uint8Array(exported.content), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${exported.fileName}"`,
      },
    })
  } catch (error) {
    if (error instanceof PackageServiceError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          details: error.details,
        },
        { status: error.status }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to export package' },
      { status: 500 }
    )
  }
}
