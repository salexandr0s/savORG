import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getApprovalById: vi.fn(),
  updateApproval: vi.fn(),
  createActivity: vi.fn(),
  resumeManagedWorkOrder: vi.fn(),
  findOperation: vi.fn(),
  verifyOperatorRequest: vi.fn(),
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => ({
    approvals: {
      getById: mocks.getApprovalById,
      update: mocks.updateApproval,
    },
    activities: {
      create: mocks.createActivity,
    },
  }),
}))

vi.mock('@/lib/services/manager', () => ({
  resumeManagedWorkOrder: mocks.resumeManagedWorkOrder,
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    operation: {
      findUnique: mocks.findOperation,
    },
  },
}))

vi.mock('@/lib/auth/operator-auth', () => ({
  verifyOperatorRequest: mocks.verifyOperatorRequest,
  asAuthErrorResponse: (result: { error: string; code: string }) => result,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getApprovalById.mockReset()
  mocks.updateApproval.mockReset()
  mocks.createActivity.mockReset()
  mocks.resumeManagedWorkOrder.mockReset()
  mocks.findOperation.mockReset()
  mocks.verifyOperatorRequest.mockReset()

  mocks.verifyOperatorRequest.mockReturnValue({
    ok: true,
    principal: {
      actor: 'user:operator',
      actorType: 'user',
      actorId: 'operator',
      sessionId: 'sess_1',
    },
  })

  mocks.getApprovalById.mockResolvedValue({
    id: 'ap_1',
    workOrderId: 'wo_1',
    operationId: 'op_1',
    type: 'risky_action',
    questionMd: 'Escalation',
    status: 'pending',
  })

  mocks.updateApproval.mockResolvedValue({
    id: 'ap_1',
    workOrderId: 'wo_1',
    operationId: 'op_1',
    type: 'risky_action',
    questionMd: 'Escalation',
    status: 'approved',
  })
})

describe('security veto finality', () => {
  it('does not auto-resume security-vetoed operations on approval', async () => {
    mocks.findOperation.mockResolvedValue({
      id: 'op_1',
      workflowId: 'greenfield_project',
      escalationReason: 'security_veto',
      blockedReason: 'security_veto',
      escalatedAt: new Date(),
    })

    const route = await import('@/app/api/approvals/[id]/route')
    const request = new NextRequest('http://localhost/api/approvals/ap_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    })

    const response = await route.PATCH(request, {
      params: Promise.resolve({ id: 'ap_1' }),
    })

    expect(response.status).toBe(200)
    expect(mocks.resumeManagedWorkOrder).not.toHaveBeenCalled()
  })
})
