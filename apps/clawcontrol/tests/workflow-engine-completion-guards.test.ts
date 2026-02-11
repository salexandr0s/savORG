import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    workOrder: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    operation: {
      findUnique: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    operationCompletionToken: {
      create: vi.fn(),
    },
    activity: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/workflows/registry', () => ({
  getWorkflowConfig: vi.fn(),
  selectWorkflowForWorkOrder: vi.fn(),
}))

vi.mock('@/lib/workflows/executor', () => ({
  dispatchToAgent: vi.fn(),
  mapAgentToStation: vi.fn(() => 'build'),
}))

vi.mock('@/lib/services/agent-resolution', () => ({
  resolveCeoSessionKey: vi.fn(),
  resolveWorkflowStageAgent: vi.fn(),
}))

vi.mock('@/lib/openclaw/sessions', () => ({
  sendToSession: vi.fn(),
}))

vi.mock('@/lib/openclaw/ingestion-lease', () => ({
  withIngestionLease: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  mocks.prisma.workOrder.findUnique.mockReset()
  mocks.prisma.operation.findUnique.mockReset()
  mocks.prisma.operation.count.mockReset()
  mocks.prisma.activity.create.mockReset()
  mocks.prisma.operationCompletionToken.create.mockReset()
  mocks.prisma.$transaction.mockReset()
})

describe('workflow engine completion/start guards', () => {
  it('rejects start from blocked state', async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo_1',
      state: 'blocked',
      workflowId: 'greenfield_project',
      blockedReason: 'manual block',
      code: 'WO-001',
      title: 't',
      goalMd: 'g',
      currentStage: 0,
      priority: 'P2',
      tags: '[]',
    })

    const engine = await import('@/lib/services/workflow-engine')

    await expect(engine.startWorkOrder('wo_1')).rejects.toThrow(
      'use resume flow instead of start'
    )
  })

  it('ignores completion when operation is not in_progress', async () => {
    mocks.prisma.operation.findUnique.mockResolvedValue({
      status: 'todo',
      workOrderId: 'wo_1',
      workOrder: { state: 'active' },
    })

    const engine = await import('@/lib/services/workflow-engine')

    const result = await engine.advanceOnCompletion('op_1', {
      status: 'completed',
      output: {},
    })

    expect(result.noop).toBe(true)
    expect(result.code).toBe('COMPLETION_INVALID_STATE')
  })

  it('ignores stale completion when work order is not active', async () => {
    mocks.prisma.operation.findUnique.mockResolvedValue({
      status: 'in_progress',
      workOrderId: 'wo_1',
      workOrder: { state: 'blocked' },
    })

    const engine = await import('@/lib/services/workflow-engine')

    const result = await engine.advanceOnCompletion('op_1', {
      status: 'completed',
      output: {},
    })

    expect(result.noop).toBe(true)
    expect(result.code).toBe('COMPLETION_STALE_IGNORED')
  })
})
