/**
 * Operations Repository
 *
 * Provides data access for operations.
 */

import { prisma } from '../db'
import type { OperationStatus } from '@clawcontrol/core'
import type { OperationDTO, OperationFilters } from './types'

const VALID_OPERATION_STATUSES = new Set<OperationStatus>([
  'todo',
  'in_progress',
  'blocked',
  'review',
  'done',
  'rework',
])

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface CreateOperationInput {
  workOrderId: string
  station: string
  title: string
  notes?: string | null
  dependsOnOperationIds?: string[]
  wipClass?: string
}

export interface UpdateOperationInput {
  status?: string
  notes?: string | null
  blockedReason?: string | null
}

export interface StatusTransitionResult {
  operation: OperationDTO
  previousStatus: string
  activityId: string
}

export interface OperationsRepo {
  list(filters?: OperationFilters): Promise<OperationDTO[]>
  getById(id: string): Promise<OperationDTO | null>
  listForWorkOrder(workOrderId: string): Promise<OperationDTO[]>
  countByStatus(): Promise<Record<string, number>>
  create(input: CreateOperationInput): Promise<OperationDTO>
  update(id: string, input: UpdateOperationInput): Promise<OperationDTO | null>
  /** Atomically update status and write activity record in a transaction */
  updateStatusWithActivity(
    id: string,
    newStatus: string,
    actor: string
  ): Promise<StatusTransitionResult | null>
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

export function createDbOperationsRepo(): OperationsRepo {
  return {
    async list(filters?: OperationFilters): Promise<OperationDTO[]> {
      const where = buildWhere(filters)
      const rows = await prisma.operation.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
      })
      return rows.map(toDTO)
    },

    async getById(id: string): Promise<OperationDTO | null> {
      const row = await prisma.operation.findUnique({ where: { id } })
      return row ? toDTO(row) : null
    },

    async listForWorkOrder(workOrderId: string): Promise<OperationDTO[]> {
      const rows = await prisma.operation.findMany({
        where: { workOrderId },
        orderBy: { createdAt: 'asc' },
      })
      return rows.map(toDTO)
    },

    async countByStatus(): Promise<Record<string, number>> {
      const groups = await prisma.operation.groupBy({
        by: ['status'],
        _count: { id: true },
      })
      return Object.fromEntries(
        groups.map((g) => [g.status, g._count.id])
      )
    },

    async create(input: CreateOperationInput): Promise<OperationDTO> {
      const row = await prisma.operation.create({
        data: {
          workOrderId: input.workOrderId,
          station: input.station,
          title: input.title,
          notes: input.notes ?? null,
          status: 'todo',
          assigneeAgentIds: '[]',
          dependsOnOperationIds: JSON.stringify(input.dependsOnOperationIds ?? []),
          wipClass: input.wipClass ?? 'implementation',
          executionType: 'single',
          retryCount: 0,
          maxRetries: 2,
          timeoutCount: 0,
        },
      })
      return toDTO(row)
    },

    async update(id: string, input: UpdateOperationInput): Promise<OperationDTO | null> {
      const existing = await prisma.operation.findUnique({ where: { id } })
      if (!existing) return null
      if (input.status !== undefined && !VALID_OPERATION_STATUSES.has(input.status as OperationStatus)) {
        throw new Error(`INVALID_OPERATION_STATUS: ${input.status}`)
      }

      const row = await prisma.operation.update({
        where: { id },
        data: {
          ...(input.status !== undefined && { status: input.status }),
          ...(input.notes !== undefined && { notes: input.notes }),
          ...(input.blockedReason !== undefined && { blockedReason: input.blockedReason }),
        },
      })

      return toDTO(row)
    },

    async updateStatusWithActivity(
      id: string,
      newStatus: string,
      actor: string
    ): Promise<StatusTransitionResult | null> {
      if (!VALID_OPERATION_STATUSES.has(newStatus as OperationStatus)) {
        throw new Error(`INVALID_OPERATION_STATUS: ${newStatus}`)
      }
      return prisma.$transaction(async (tx) => {
        // Get current operation
        const existing = await tx.operation.findUnique({ where: { id } })
        if (!existing) return null

        const previousStatus = existing.status

        // Update operation
        const row = await tx.operation.update({
          where: { id },
          data: { status: newStatus },
        })

        // Create activity record
        const activityId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        await tx.activity.create({
          data: {
            id: activityId,
            ts: new Date(),
            type: 'operation.status_changed',
            actor,
            entityType: 'operation',
            entityId: id,
            summary: `Operation transitioned to ${newStatus}`,
            payloadJson: JSON.stringify({
              workOrderId: existing.workOrderId,
              previousStatus,
              newStatus,
            }),
          },
        })

        return {
          operation: toDTO(row),
          previousStatus,
          activityId,
        }
      })
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function buildWhere(filters?: OperationFilters) {
  if (!filters) return {}
  const where: Record<string, unknown> = {}
  if (filters.workOrderId) {
    where.workOrderId = filters.workOrderId
  }
  if (filters.status) {
    where.status = Array.isArray(filters.status) ? { in: filters.status } : filters.status
  }
  if (filters.station) {
    where.station = Array.isArray(filters.station) ? { in: filters.station } : filters.station
  }
  return where
}

function toDTO(row: {
  id: string
  workOrderId: string
  station: string
  title: string
  notes: string | null
  status: string
  workflowId: string | null
  workflowStageIndex: number
  iterationCount: number
  executionType: string
  currentStoryId: string | null
  retryCount: number
  maxRetries: number
  claimedBy: string | null
  claimExpiresAt: Date | null
  lastClaimedAt: Date | null
  timeoutCount: number
  assigneeAgentIds: string
  dependsOnOperationIds: string
  wipClass: string
  blockedReason: string | null
  createdAt: Date
  updatedAt: Date
}): OperationDTO {
  return {
    id: row.id,
    workOrderId: row.workOrderId,
    station: row.station,
    title: row.title,
    notes: row.notes,
    status: row.status as OperationDTO['status'],
    workflowId: row.workflowId,
    workflowStageIndex: row.workflowStageIndex,
    iterationCount: row.iterationCount,
    executionType: row.executionType as OperationDTO['executionType'],
    currentStoryId: row.currentStoryId,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    claimedBy: row.claimedBy,
    claimExpiresAt: row.claimExpiresAt,
    lastClaimedAt: row.lastClaimedAt,
    timeoutCount: row.timeoutCount,
    assigneeAgentIds: JSON.parse(row.assigneeAgentIds),
    dependsOnOperationIds: JSON.parse(row.dependsOnOperationIds),
    wipClass: row.wipClass,
    blockedReason: row.blockedReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
