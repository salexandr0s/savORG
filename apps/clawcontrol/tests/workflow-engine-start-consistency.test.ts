import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  prisma: {
    workOrder: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    operation: {
      count: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    activity: {
      create: vi.fn(),
    },
    operationStory: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  selectWorkflowForWorkOrder: vi.fn(),
  getWorkflowConfig: vi.fn(),
  resolveWorkflowStageAgent: vi.fn(),
  dispatchToAgent: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: mocks.prisma,
}))

vi.mock('@/lib/workflows/registry', () => ({
  selectWorkflowForWorkOrder: mocks.selectWorkflowForWorkOrder,
  getWorkflowConfig: mocks.getWorkflowConfig,
}))

vi.mock('@/lib/services/agent-resolution', () => ({
  resolveWorkflowStageAgent: mocks.resolveWorkflowStageAgent,
  resolveCeoSessionKey: vi.fn(),
}))

vi.mock('@/lib/workflows/executor', () => ({
  dispatchToAgent: mocks.dispatchToAgent,
  mapAgentToStation: vi.fn(() => 'build'),
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
  mocks.prisma.workOrder.update.mockReset()
  mocks.prisma.operation.count.mockReset()
  mocks.prisma.operation.findUnique.mockReset()
  mocks.prisma.operation.updateMany.mockReset()
  mocks.prisma.operation.update.mockReset()
  mocks.prisma.activity.create.mockReset()
  mocks.prisma.operationStory.findMany.mockReset()
  mocks.prisma.$transaction.mockReset()

  mocks.selectWorkflowForWorkOrder.mockReset()
  mocks.getWorkflowConfig.mockReset()
  mocks.resolveWorkflowStageAgent.mockReset()
  mocks.dispatchToAgent.mockReset()

  mocks.prisma.operation.count.mockResolvedValue(0)
  mocks.selectWorkflowForWorkOrder.mockResolvedValue({
    workflowId: 'greenfield_project',
    reason: 'explicit',
    matchedRuleId: null,
  })
  mocks.getWorkflowConfig.mockResolvedValue({
    id: 'greenfield_project',
    description: 'test',
    stages: [
      {
        ref: 'plan',
        agent: 'plan',
      },
    ],
  })
  mocks.resolveWorkflowStageAgent.mockResolvedValue({
    id: 'agent_plan',
    station: 'spec',
    displayName: 'Plan Agent',
  })

  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: any) => Promise<unknown>) => {
    const tx = {
      workOrder: {
        update: vi.fn().mockResolvedValue(undefined),
      },
      activity: {
        create: vi.fn().mockResolvedValue(undefined),
      },
      operation: {
        create: vi.fn().mockResolvedValue({
          id: 'op_1',
          workOrderId: 'wo_1',
          workflowId: 'greenfield_project',
          workflowStageIndex: 0,
          executionType: 'single',
          currentStoryId: null,
          notes: null,
          workOrder: {
            id: 'wo_1',
            goalMd: 'goal',
            workflowId: 'greenfield_project',
          },
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
    return fn(tx)
  })

  // dispatchOperation() lookup
  mocks.prisma.operation.findUnique.mockResolvedValue({
    id: 'op_1',
    workOrderId: 'wo_1',
    workflowId: 'greenfield_project',
    workflowStageIndex: 0,
    executionType: 'single',
    currentStoryId: null,
    notes: null,
    workOrder: {
      id: 'wo_1',
      goalMd: 'goal',
      workflowId: 'greenfield_project',
    },
  })

  // Claim fails -> dispatchOperation() returns dispatched:false
  mocks.prisma.operation.updateMany.mockResolvedValue({ count: 0 })
  mocks.prisma.operationStory.findMany.mockResolvedValue([])
})

describe('workflow engine start consistency', () => {
  it('blocks work order when initial dispatch fails', async () => {
    mocks.prisma.workOrder.findUnique.mockResolvedValue({
      id: 'wo_1',
      code: 'WO-001',
      title: 'test',
      goalMd: 'goal',
      state: 'planned',
      workflowId: null,
      currentStage: 0,
      priority: 'P2',
      tags: '[]',
      blockedReason: null,
    })

    const engine = await import('@/lib/services/workflow-engine')

    await expect(engine.startWorkOrder('wo_1')).rejects.toThrow('Operation claim failed')

    expect(mocks.prisma.workOrder.update).toHaveBeenCalledWith({
      where: { id: 'wo_1' },
      data: {
        state: 'blocked',
        blockedReason: 'Operation claim failed',
      },
    })
  })
})
