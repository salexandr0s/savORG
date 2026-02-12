import { NextRequest, NextResponse } from 'next/server'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'
import { analyzePackageImport, PackageServiceError } from '@/lib/packages/service'

/**
 * POST /api/packages/import
 * Stage and analyze a .clawpack.zip package before deployment.
 */
export async function POST(request: NextRequest) {
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const formData = await request.formData().catch(() => null)
  if (!formData) {
    return NextResponse.json({ error: 'multipart/form-data is required' }, { status: 400 })
  }

  const file = formData.get('file')
  const typedConfirmText = typeof formData.get('typedConfirmText') === 'string'
    ? String(formData.get('typedConfirmText'))
    : undefined

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Package file is required' }, { status: 400 })
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'package.import',
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
    const analysis = await analyzePackageImport(file)
    return NextResponse.json({ data: analysis }, { status: 201 })
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
      { error: error instanceof Error ? error.message : 'Failed to analyze package' },
      { status: 500 }
    )
  }
}
