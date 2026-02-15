import { NextRequest, NextResponse } from 'next/server'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'
import {
  deployStagedPackage,
  getStagedPackageScanMeta,
  PackageServiceError,
  type PackageDeployOptions,
} from '@/lib/packages/service'
import { getRepos } from '@/lib/repo'

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
    overrideScanBlock?: boolean
  } | null

  if (!body || typeof body.packageId !== 'string' || !body.packageId.trim()) {
    return NextResponse.json({ error: 'packageId is required' }, { status: 400 })
  }

  const packageId = body.packageId.trim()
  const scanMeta = getStagedPackageScanMeta(packageId)
  const isBlockedByScan = Boolean(scanMeta?.blockedByScan)
  const overrideScanBlock = Boolean(body.overrideScanBlock)

  if (isBlockedByScan && !overrideScanBlock) {
    return NextResponse.json(
      {
        error: 'Package blocked by security scan',
        code: 'PACKAGE_BLOCKED_BY_SCAN',
        details: {
          packageId,
          sha256: scanMeta?.sha256,
          scan: scanMeta?.scan,
          alertWorkOrderId: scanMeta?.alertWorkOrderId,
        },
      },
      { status: 409 }
    )
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'package.deploy',
    typedConfirmText: body.typedConfirmText,
    expectedConfirmText: isBlockedByScan && overrideScanBlock ? 'OVERRIDE_SCAN_BLOCK' : undefined,
  })

  if (!enforcement.allowed) {
    return NextResponse.json(
      {
        error: enforcement.errorType,
        policy: enforcement.policy,
        details: enforcement.details,
      },
      { status: enforcement.status ?? 403 }
    )
  }

  if (isBlockedByScan && overrideScanBlock) {
    const overrideEnforcement = await enforceActionPolicy({
      actionKind: 'package.deploy.override_scan_block',
      typedConfirmText: body.typedConfirmText,
    })

    if (!overrideEnforcement.allowed) {
      return NextResponse.json(
        {
          error: overrideEnforcement.errorType,
          policy: overrideEnforcement.policy,
          details: overrideEnforcement.details,
        },
        { status: overrideEnforcement.status ?? 403 }
      )
    }
  }

  try {
    const result = await deployStagedPackage({
      packageId,
      options: body.options,
      overrideScanBlock,
    })

    if (isBlockedByScan && overrideScanBlock) {
      const repos = getRepos()
      await repos.activities.create({
        type: 'security.scan_override',
        actor: auth.principal.actor,
        actorType: auth.principal.actorType,
        entityType: 'package',
        entityId: scanMeta?.sha256 ?? packageId,
        category: 'security',
        riskLevel: 'danger',
        summary: `Security scan override used to deploy package (${packageId})`,
        payloadJson: {
          packageId,
          sha256: scanMeta?.sha256 ?? null,
          scan: scanMeta?.scan
            ? {
                outcome: scanMeta.scan.outcome,
                summaryCounts: scanMeta.scan.summaryCounts,
                scannerVersion: scanMeta.scan.scannerVersion,
              }
            : null,
          alertWorkOrderId: scanMeta?.alertWorkOrderId ?? null,
        },
      })
    }

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
