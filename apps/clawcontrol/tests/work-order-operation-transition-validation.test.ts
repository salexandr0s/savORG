import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getByIdWorkOrder: vi.fn(),
  updateWorkOrder: vi.fn(),
  getByIdOperation: vi.fn(),
  updateOperation: vi.fn(),
  enforceGovernor: vi.fn(),
  getRequestActor: vi.fn(),
  verifyOperatorRequest: vi.fn(),
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => ({
    workOrders: {
      getById: mocks.getByIdWorkOrder,
      update: mocks.updateWorkOrder,
      updateStateWithActivity: vi.fn(),
    },
    operations: {
      getById: mocks.getByIdOperation,
      update: mocks.updateOperation,
      updateStatusWithActivity: vi.fn(),
    },
  }),
}))

vi.mock('@/lib/with-governor', () => ({
  enforceGovernor: mocks.enforceGovernor,
}))

vi.mock('@/lib/request-actor', () => ({
  getRequestActor: mocks.getRequestActor,
}))

vi.mock('@/lib/auth/operator-auth', () => ({
  verifyOperatorRequest: mocks.verifyOperatorRequest,
  asAuthErrorResponse: (result: { error: string; code: string }) => result,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getByIdWorkOrder.mockReset()
  mocks.updateWorkOrder.mockReset()
  mocks.getByIdOperation.mockReset()
  mocks.updateOperation.mockReset()
  mocks.enforceGovernor.mockReset()
  mocks.getRequestActor.mockReset()
  mocks.verifyOperatorRequest.mockReset()

  mocks.enforceGovernor.mockResolvedValue({ allowed: true })
  mocks.getRequestActor.mockReturnValue({ actor: 'user', actorType: 'user', actorId: 'operator' })
  mocks.verifyOperatorRequest.mockReturnValue({
    ok: true,
    principal: {
      actor: 'user:operator',
      actorType: 'user',
      actorId: 'operator',
      sessionId: 'sess_test',
    },
  })
})

describe('state/status transition validation', () => {
  it('rejects empty-string work-order state', async () => {
    mocks.getByIdWorkOrder.mockResolvedValue({ id: 'wo_1', state: 'planned' })

    const route = await import('@/app/api/work-orders/[id]/route')
    const request = new NextRequest('http://localhost/api/work-orders/wo_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: '' }),
    })

    const response = await route.PATCH(request, { params: Promise.resolve({ id: 'wo_1' }) })
    const payload = (await response.json()) as { code?: string }

    expect(response.status).toBe(400)
    expect(payload.code).toBe('INVALID_STATE')
    expect(mocks.updateWorkOrder).not.toHaveBeenCalled()
  })

  it('rejects empty-string operation status', async () => {
    mocks.getByIdOperation.mockResolvedValue({ id: 'op_1', status: 'todo' })

    const route = await import('@/app/api/operations/[id]/route')
    const request = new NextRequest('http://localhost/api/operations/op_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: '' }),
    })

    const response = await route.PATCH(request, { params: Promise.resolve({ id: 'op_1' }) })
    const payload = (await response.json()) as { code?: string }

    expect(response.status).toBe(400)
    expect(payload.code).toBe('INVALID_STATUS')
    expect(mocks.updateOperation).not.toHaveBeenCalled()
  })
})
