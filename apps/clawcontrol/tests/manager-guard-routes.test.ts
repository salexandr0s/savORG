import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getByIdWorkOrder: vi.fn(),
  updateStateWithActivity: vi.fn(),
  updateWorkOrder: vi.fn(),
  getByIdOperation: vi.fn(),
  updateStatusWithActivity: vi.fn(),
  updateOperation: vi.fn(),
  enforceGovernor: vi.fn(),
  getRequestActor: vi.fn(),
  verifyOperatorRequest: vi.fn(),
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => ({
    workOrders: {
      getById: mocks.getByIdWorkOrder,
      updateStateWithActivity: mocks.updateStateWithActivity,
      update: mocks.updateWorkOrder,
    },
    operations: {
      getById: mocks.getByIdOperation,
      updateStatusWithActivity: mocks.updateStatusWithActivity,
      update: mocks.updateOperation,
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
  asAuthErrorResponse: (result: { error: string; code: string }) => ({
    error: result.error,
    code: result.code,
  }),
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getByIdWorkOrder.mockReset()
  mocks.updateStateWithActivity.mockReset()
  mocks.updateWorkOrder.mockReset()
  mocks.getByIdOperation.mockReset()
  mocks.updateStatusWithActivity.mockReset()
  mocks.updateOperation.mockReset()
  mocks.enforceGovernor.mockReset()
  mocks.getRequestActor.mockReset()
  mocks.verifyOperatorRequest.mockReset()

  mocks.enforceGovernor.mockResolvedValue({ allowed: true })
  mocks.getRequestActor.mockReturnValue({
    actor: 'user',
    actorType: 'user',
    actorId: 'user',
  })
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

describe('manager-controlled route guards', () => {
  it('blocks manual activation via PATCH /api/work-orders/:id', async () => {
    mocks.getByIdWorkOrder.mockResolvedValue({
      id: 'wo_1',
      state: 'planned',
    })

    const route = await import('@/app/api/work-orders/[id]/route')
    const request = new NextRequest('http://localhost/api/work-orders/wo_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'active' }),
    })

    const response = await route.PATCH(request, {
      params: Promise.resolve({ id: 'wo_1' }),
    })
    const payload = (await response.json()) as { code?: string }

    expect(response.status).toBe(400)
    expect(payload.code).toBe('MANAGER_CONTROLLED_STATE')
    expect(mocks.updateStateWithActivity).not.toHaveBeenCalled()
  })

  it('returns 410 for manual operation graph creation', async () => {
    const route = await import('@/app/api/operations/route')
    const request = new NextRequest('http://localhost/api/operations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workOrderId: 'wo_1',
        station: 'build',
        title: 'manual op',
      }),
    })

    const response = await route.POST(request)
    const payload = (await response.json()) as { code?: string }

    expect(response.status).toBe(410)
    expect(payload.code).toBe('MANAGER_CONTROLLED_OPERATION_GRAPH')
  })

  it('blocks manual operation status updates for non-manager actors', async () => {
    mocks.getByIdOperation.mockResolvedValue({
      id: 'op_1',
      status: 'todo',
    })

    const route = await import('@/app/api/operations/[id]/route')
    const request = new NextRequest('http://localhost/api/operations/op_1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress' }),
    })

    const response = await route.PATCH(request, {
      params: Promise.resolve({ id: 'op_1' }),
    })
    const payload = (await response.json()) as { code?: string }

    expect(response.status).toBe(403)
    expect(payload.code).toBe('MANAGER_CONTROLLED_OPERATION_STATUS')
    expect(mocks.updateStatusWithActivity).not.toHaveBeenCalled()
  })
})
