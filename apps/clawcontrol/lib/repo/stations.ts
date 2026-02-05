/**
 * Stations Repository
 *
 * Provides data access for stations with both DB and mock implementations.
 */

import { prisma } from '../db'
import type { StationDTO } from './types'

// ============================================================================
// REPOSITORY INTERFACE
// ============================================================================

export interface CreateStationInput {
  /** Stable, user-facing id (kebab-case slug). */
  id: string
  name: string
  icon: string
  description?: string | null
  color?: string | null
  sortOrder?: number
}

export interface UpdateStationInput {
  name?: string
  icon?: string
  description?: string | null
  color?: string | null
  sortOrder?: number
}

export interface StationsRepo {
  list(): Promise<StationDTO[]>
  getById(id: string): Promise<StationDTO | null>
  getByName(name: string): Promise<StationDTO | null>
  create(input: CreateStationInput): Promise<StationDTO>
  update(id: string, input: UpdateStationInput): Promise<StationDTO | null>
  delete(id: string): Promise<boolean>
}

// ============================================================================
// DATABASE IMPLEMENTATION
// ============================================================================

export function createDbStationsRepo(): StationsRepo {
  return {
    async list(): Promise<StationDTO[]> {
      const rows = await prisma.station.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })
      return rows.map(toDTO)
    },

    async getById(id: string): Promise<StationDTO | null> {
      const row = await prisma.station.findUnique({ where: { id } })
      return row ? toDTO(row) : null
    },

    async getByName(name: string): Promise<StationDTO | null> {
      const row = await prisma.station.findUnique({ where: { name } })
      return row ? toDTO(row) : null
    },

    async create(input: CreateStationInput): Promise<StationDTO> {
      const row = await prisma.station.create({
        data: {
          id: input.id,
          name: input.name,
          icon: input.icon,
          description: input.description ?? null,
          color: input.color ?? null,
          sortOrder: input.sortOrder ?? 0,
        },
      })
      return toDTO(row)
    },

    async update(id: string, input: UpdateStationInput): Promise<StationDTO | null> {
      const existing = await prisma.station.findUnique({ where: { id } })
      if (!existing) return null

      const row = await prisma.station.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.icon !== undefined && { icon: input.icon }),
          ...(input.description !== undefined && { description: input.description }),
          ...(input.color !== undefined && { color: input.color }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        },
      })

      return toDTO(row)
    },

    async delete(id: string): Promise<boolean> {
      const existing = await prisma.station.findUnique({ where: { id } })
      if (!existing) return false
      await prisma.station.delete({ where: { id } })
      return true
    },
  }
}

// ============================================================================
// MOCK IMPLEMENTATION
// ============================================================================

const DEFAULT_STATIONS: Array<Omit<StationDTO, 'createdAt' | 'updatedAt'>> = [
  {
    id: 'spec',
    name: 'spec',
    icon: 'file-text',
    description: 'Planning & specifications',
    color: null,
    sortOrder: 10,
  },
  {
    id: 'build',
    name: 'build',
    icon: 'hammer',
    description: 'Implementation',
    color: null,
    sortOrder: 20,
  },
  {
    id: 'qa',
    name: 'qa',
    icon: 'check-circle',
    description: 'Quality assurance',
    color: null,
    sortOrder: 30,
  },
  {
    id: 'ops',
    name: 'ops',
    icon: 'settings',
    description: 'Operations',
    color: null,
    sortOrder: 40,
  },
]

const mockStations: StationDTO[] = DEFAULT_STATIONS.map((s) => ({
  ...s,
  createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
  updatedAt: new Date(),
}))

export function createMockStationsRepo(): StationsRepo {
  return {
    async list(): Promise<StationDTO[]> {
      return [...mockStations].sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name))
    },

    async getById(id: string): Promise<StationDTO | null> {
      return mockStations.find((s) => s.id === id) ?? null
    },

    async getByName(name: string): Promise<StationDTO | null> {
      return mockStations.find((s) => s.name === name) ?? null
    },

    async create(input: CreateStationInput): Promise<StationDTO> {
      const now = new Date()
      const dto: StationDTO = {
        id: input.id,
        name: input.name,
        icon: input.icon,
        description: input.description ?? null,
        color: input.color ?? null,
        sortOrder: input.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      }
      mockStations.push(dto)
      return dto
    },

    async update(id: string, input: UpdateStationInput): Promise<StationDTO | null> {
      const idx = mockStations.findIndex((s) => s.id === id)
      if (idx === -1) return null
      const existing = mockStations[idx]
      const updated: StationDTO = {
        ...existing,
        ...(input.name !== undefined && { name: input.name }),
        ...(input.icon !== undefined && { icon: input.icon }),
        ...(input.description !== undefined && { description: input.description ?? null }),
        ...(input.color !== undefined && { color: input.color ?? null }),
        ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        updatedAt: new Date(),
      }
      mockStations[idx] = updated
      return updated
    },

    async delete(id: string): Promise<boolean> {
      const idx = mockStations.findIndex((s) => s.id === id)
      if (idx === -1) return false
      mockStations.splice(idx, 1)
      return true
    },
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function toDTO(row: {
  id: string
  name: string
  icon: string
  description: string | null
  color: string | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}): StationDTO {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    description: row.description,
    color: row.color,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

