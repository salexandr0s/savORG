import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getWorkOrder: vi.fn(),
  getOperation: vi.fn(),
  listApprovals: vi.fn(),
  createApproval: vi.fn(),
  createActivity: vi.fn(),
  verifyOperatorRequest: vi.fn(),
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => ({
    workOrders: {
      getById: mocks.getWorkOrder,
    },
    operations: {
      getById: mocks.getOperation,
    },
    approvals: {
      list: mocks.listApprovals,
      create: mocks.createApproval,
    },
    activities: {
      create: mocks.createActivity,
    },
  }),
}))

vi.mock('@/lib/auth/operator-auth', () => ({
  verifyOperatorRequest: mocks.verifyOperatorRequest,
  asAuthErrorResponse: (result: { error: string; code: string }) => result,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getWorkOrder.mockReset()
  mocks.getOperation.mockReset()
  mocks.listApprovals.mockReset()
  mocks.createApproval.mockReset()
  mocks.createActivity.mockReset()
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

  mocks.getWorkOrder.mockResolvedValue({ id: 'wo_1' })
  mocks.listApprovals.mockResolvedValue([])
})

describe('approval linkage integrity', () => {
  it('rejects approval creation when operation belongs to another work order', async () => {
    mocks.getOperation.mockResolvedValue({
      id: 'op_1',
      workOrderId: 'wo_2',
    })

    const route = await import('@/app/api/approvals/route')
    const request = new NextRequest('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workOrderId: 'wo_1',
        operationId: 'op_1',
        type: 'scope_change',
        questionMd: 'approve',
      }),
    })

    const response = await route.POST(request)
    const payload = (await response.json()) as { code?: string }

    expect(response.status).toBe(400)
    expect(payload.code).toBe('APPROVAL_OPERATION_WORKORDER_MISMATCH')
    expect(mocks.createApproval).not.toHaveBeenCalled()
  })
})
