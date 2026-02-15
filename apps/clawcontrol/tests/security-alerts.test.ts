import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    securityAlert: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    workOrder: {
      delete: vi.fn(),
    },
  },
  workOrdersCreate: vi.fn(),
  activitiesCreate: vi.fn(),
  getWorkflowRegistrySnapshot: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => ({
    workOrders: { create: mocks.workOrdersCreate },
    activities: { create: mocks.activitiesCreate },
  }),
}))

vi.mock('@/lib/workflows/registry', () => ({
  getWorkflowRegistrySnapshot: mocks.getWorkflowRegistrySnapshot,
}))

describe('security alerts', () => {
  beforeEach(() => {
    mocks.prisma.securityAlert.findUnique.mockReset()
    mocks.prisma.securityAlert.create.mockReset()
    mocks.prisma.workOrder.delete.mockReset()
    mocks.workOrdersCreate.mockReset()
    mocks.activitiesCreate.mockReset()
    mocks.getWorkflowRegistrySnapshot.mockReset()

    mocks.getWorkflowRegistrySnapshot.mockResolvedValue({
      definitions: [{ id: 'security_audit' }],
    })
  })

  it('returns existing work order when alert already exists', async () => {
    mocks.prisma.securityAlert.findUnique.mockResolvedValue({
      artifactKey: 'sha',
      workOrderId: 'wo_existing',
    })

    const { ensureBlockedScanWorkOrder } = await import('@/lib/services/security-alerts')

    const result = await ensureBlockedScanWorkOrder({
      sha256: 'sha',
      manifest: { id: 'm', name: 'M', version: '1.0.0', kind: 'workflow' },
      scan: {
        outcome: 'block',
        blocked: true,
        summaryCounts: { danger: 1, warning: 0, info: 0 },
        findings: [],
        scannerVersion: 'v1',
      },
    })

    expect(result.workOrderId).toBe('wo_existing')
    expect(result.created).toBe(false)
    expect(mocks.workOrdersCreate).not.toHaveBeenCalled()
  })
})

