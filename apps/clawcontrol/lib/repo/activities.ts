/**
 * Activities Repository
 *
 * Provides data access for activities.
 * Publishes activities to the pub/sub system for SSE streaming.
 */

import { prisma } from '../db'
import { normalizeActorRef, type ActorType } from '../agent-identity'
import { publishActivity } from '../pubsub'
import type { ActivityDTO, ActivityFilters, PaginationOptions } from './types'

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface CreateActivityInput {
  type: string
  actor: string
  actorType?: ActorType
  actorAgentId?: string | null
  actorLabel?: string
  entityType: string
  entityId: string
  summary: string
  category?: string
  riskLevel?: 'safe' | 'caution' | 'danger'
  payloadJson?: Record<string, unknown>
}

export interface ActivitiesRepo {
  list(filters?: ActivityFilters, pagination?: PaginationOptions): Promise<ActivityDTO[]>
  getById(id: string): Promise<ActivityDTO | null>
  listRecent(limit?: number): Promise<ActivityDTO[]>
  listForEntity(entityType: string, entityId: string): Promise<ActivityDTO[]>
  create(input: CreateActivityInput): Promise<ActivityDTO>
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

export function createDbActivitiesRepo(): ActivitiesRepo {
  return {
    async list(filters?: ActivityFilters, pagination?: PaginationOptions): Promise<ActivityDTO[]> {
      const where = buildWhere(filters)
      const rows = await prisma.activity.findMany({
        where,
        orderBy: { ts: 'desc' },
        take: pagination?.limit ?? 50,
        skip: pagination?.offset ?? 0,
      })
      return rows.map(toDTO)
    },

    async getById(id: string): Promise<ActivityDTO | null> {
      const row = await prisma.activity.findUnique({ where: { id } })
      return row ? toDTO(row) : null
    },

    async listRecent(limit = 20): Promise<ActivityDTO[]> {
      const rows = await prisma.activity.findMany({
        orderBy: { ts: 'desc' },
        take: limit,
      })
      return rows.map(toDTO)
    },

    async listForEntity(entityType: string, entityId: string): Promise<ActivityDTO[]> {
      const rows = await prisma.activity.findMany({
        where: { entityType, entityId },
        orderBy: { ts: 'desc' },
      })
      return rows.map(toDTO)
    },

    async create(input: CreateActivityInput): Promise<ActivityDTO> {
      const id = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const actorRef = normalizeActorRef({
        actor: input.actor,
        actorType: input.actorType,
        actorAgentId: input.actorAgentId,
      })

      const row = await prisma.activity.create({
        data: {
          id,
          ts: new Date(),
          type: input.type,
          category: input.category ?? 'system',
          actor: actorRef.actor,
          actorType: actorRef.actorType,
          actorAgentId: actorRef.actorAgentId,
          entityType: input.entityType,
          entityId: input.entityId,
          summary: input.summary,
          riskLevel: input.riskLevel ?? 'safe',
          payloadJson: JSON.stringify(input.payloadJson ?? {}),
        },
      })
      const dto = toDTO(row)

      // Publish to SSE stream
      publishActivity(dto)

      return dto
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function buildWhere(filters?: ActivityFilters) {
  if (!filters) return {}
  const where: Record<string, unknown> = {}
  if (filters.entityType) {
    where.entityType = filters.entityType
  }
  if (filters.entityId) {
    where.entityId = filters.entityId
  }
  if (filters.type) {
    where.type = filters.type
  }
  if (filters.category) {
    where.category = filters.category
  }
  if (filters.riskLevel) {
    where.riskLevel = filters.riskLevel
  }
  return where
}

function formatActorLabel(
  actor: string,
  actorType: string | null | undefined,
  actorAgentId: string | null | undefined
): string {
  if ((actorType ?? '').toLowerCase() === 'user') return 'User'
  if ((actorType ?? '').toLowerCase() === 'system') return 'System'

  if ((actorType ?? '').toLowerCase() === 'agent') {
    if (actor.toLowerCase().startsWith('agent:')) {
      return actor.slice('agent:'.length)
    }
    return actorAgentId || 'Agent'
  }

  if (actor.toLowerCase().startsWith('agent:')) return actor.slice('agent:'.length)
  if (actor === 'user') return 'User'
  if (actor === 'system') return 'System'
  return actor
}

function toDTO(row: {
  id: string
  ts: Date
  type: string
  category: string
  actor: string
  actorType?: string | null
  actorAgentId?: string | null
  entityType: string
  entityId: string
  summary: string
  riskLevel: string
  payloadJson: string
}): ActivityDTO {
  return {
    id: row.id,
    ts: row.ts,
    type: row.type,
    category: row.category ?? 'system',
    riskLevel: (row.riskLevel as ActivityDTO['riskLevel']) ?? 'safe',
    actor: row.actor,
    actorType: ((row.actorType ?? 'system') as ActivityDTO['actorType']),
    actorAgentId: row.actorAgentId ?? null,
    actorLabel: formatActorLabel(row.actor, row.actorType, row.actorAgentId),
    entityType: row.entityType,
    entityId: row.entityId,
    summary: row.summary,
    payloadJson: JSON.parse(row.payloadJson),
  }
}
