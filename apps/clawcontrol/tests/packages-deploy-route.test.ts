import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyOperatorRequest: vi.fn(),
  enforceActionPolicy: vi.fn(),
  deployStagedPackage: vi.fn(),
  getStagedPackageScanMeta: vi.fn(),
  activitiesCreate: vi.fn(),
}))

vi.mock('@/lib/auth/operator-auth', () => ({
  verifyOperatorRequest: mocks.verifyOperatorRequest,
  asAuthErrorResponse: (result: { error: string; code: string }) => ({
    error: result.error,
    code: result.code,
  }),
}))

vi.mock('@/lib/with-governor', () => ({
  enforceActionPolicy: mocks.enforceActionPolicy,
}))

vi.mock('@/lib/packages/service', () => ({
  deployStagedPackage: mocks.deployStagedPackage,
  getStagedPackageScanMeta: mocks.getStagedPackageScanMeta,
  PackageServiceError: class PackageServiceError extends Error {
    constructor(
      message: string,
      public code: string,
      public status: number,
      public details?: Record<string, unknown>
    ) {
      super(message)
      this.name = 'PackageServiceError'
    }
  },
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => ({
    activities: {
      create: mocks.activitiesCreate,
    },
  }),
}))

beforeEach(() => {
  vi.resetModules()
  mocks.verifyOperatorRequest.mockReset()
  mocks.enforceActionPolicy.mockReset()
  mocks.deployStagedPackage.mockReset()
  mocks.getStagedPackageScanMeta.mockReset()
  mocks.activitiesCreate.mockReset()

  mocks.verifyOperatorRequest.mockReturnValue({
    ok: true,
    principal: {
      actor: 'user:operator',
      actorType: 'user',
      actorId: 'operator',
      sessionId: 'sess_test',
    },
  })

  mocks.enforceActionPolicy.mockResolvedValue({
    allowed: true,
    policy: { requiresApproval: false, confirmMode: 'CONFIRM' },
  })

  mocks.getStagedPackageScanMeta.mockReturnValue(null)
})

describe('packages deploy route', () => {
  it('returns 400 when packageId is missing', async () => {
    const route = await import('@/app/api/packages/deploy/route')
    const request = new Request('http://localhost/api/packages/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ options: { applyWorkflows: true } }),
    })

    const response = await route.POST(request as never)
    const payload = (await response.json()) as { error: string }

    expect(response.status).toBe(400)
    expect(payload.error).toContain('packageId')
  })

  it('deploys a staged package', async () => {
    mocks.deployStagedPackage.mockResolvedValue({
      packageId: 'pkg_1',
      deployed: {
        templates: ['alpha-template'],
        workflows: ['custom_flow'],
        teams: ['team_1'],
        selectionApplied: true,
      },
    })

    const route = await import('@/app/api/packages/deploy/route')
    const request = new Request('http://localhost/api/packages/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageId: 'pkg_1',
        options: { applyTemplates: true },
        typedConfirmText: 'CONFIRM',
      }),
    })

    const response = await route.POST(request as never)
    const payload = (await response.json()) as {
      data: {
        packageId: string
        deployed: { workflows: string[] }
      }
    }

    expect(response.status).toBe(200)
    expect(payload.data.packageId).toBe('pkg_1')
    expect(payload.data.deployed.workflows).toContain('custom_flow')
    expect(mocks.deployStagedPackage).toHaveBeenCalledWith({
      packageId: 'pkg_1',
      options: { applyTemplates: true },
      overrideScanBlock: false,
    })
  })

  it('short-circuits when blocked by scan and no override is provided', async () => {
    mocks.getStagedPackageScanMeta.mockReturnValue({
      sha256: 'sha_1',
      blockedByScan: true,
      alertWorkOrderId: 'wo_1',
      scan: {
        outcome: 'block',
        blocked: true,
        summaryCounts: { danger: 1, warning: 0, info: 0 },
        findings: [],
        scannerVersion: 'v1',
      },
    })

    const route = await import('@/app/api/packages/deploy/route')
    const request = new Request('http://localhost/api/packages/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageId: 'pkg_1',
        typedConfirmText: 'CONFIRM',
      }),
    })

    const response = await route.POST(request as never)
    const payload = (await response.json()) as { code: string }

    expect(response.status).toBe(409)
    expect(payload.code).toBe('PACKAGE_BLOCKED_BY_SCAN')
    expect(mocks.deployStagedPackage).not.toHaveBeenCalled()
  })

  it('allows governed override when blocked and overrideScanBlock is true', async () => {
    mocks.getStagedPackageScanMeta.mockReturnValue({
      sha256: 'sha_1',
      blockedByScan: true,
      alertWorkOrderId: 'wo_1',
      scan: {
        outcome: 'block',
        blocked: true,
        summaryCounts: { danger: 1, warning: 0, info: 0 },
        findings: [],
        scannerVersion: 'v1',
      },
    })

    mocks.deployStagedPackage.mockResolvedValue({
      packageId: 'pkg_1',
      deployed: { templates: [], workflows: [], teams: [], selectionApplied: false },
    })

    mocks.enforceActionPolicy.mockImplementation(async (params: { actionKind: string }) => {
      if (params.actionKind === 'package.deploy.override_scan_block') {
        return { allowed: true, policy: { requiresApproval: true, confirmMode: 'CONFIRM' } }
      }
      return { allowed: true, policy: { requiresApproval: true, confirmMode: 'CONFIRM' } }
    })

    const route = await import('@/app/api/packages/deploy/route')
    const request = new Request('http://localhost/api/packages/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        packageId: 'pkg_1',
        typedConfirmText: 'OVERRIDE_SCAN_BLOCK',
        overrideScanBlock: true,
      }),
    })

    const response = await route.POST(request as never)
    expect(response.status).toBe(200)
    expect(mocks.deployStagedPackage).toHaveBeenCalledWith({
      packageId: 'pkg_1',
      options: undefined,
      overrideScanBlock: true,
    })
    expect(mocks.activitiesCreate).toHaveBeenCalled()
  })
})
