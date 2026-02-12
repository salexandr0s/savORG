import { NextRequest, NextResponse } from 'next/server'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'
import {
  deployStagedPackage,
  PackageServiceError,
  type PackageDeployOptions,
} from '@/lib/packages/service'

/**
 * POST /api/packages/deploy
 * Deploy a previously analyzed package.
 */
export async function POST(request: NextRequest) {
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = (await request.json().catch(() => null)) as {
    packageId?: string
    options?: PackageDeployOptions
    typedConfirmText?: string
  } | null

  if (!body || typeof body.packageId !== 'string' || !body.packageId.trim()) {
    return NextResponse.json({ error: 'packageId is required' }, { status: 400 })
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'package.deploy',
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
    const result = await deployStagedPackage({
      packageId: body.packageId.trim(),
      options: body.options,
    })

    return NextResponse.json({ data: result })
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
      { error: error instanceof Error ? error.message : 'Failed to deploy package' },
      { status: 500 }
    )
  }
}
