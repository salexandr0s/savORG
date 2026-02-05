'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { StationDTO } from '@/lib/repo'
import { stationsApi } from '@/lib/http'

interface StationsContextValue {
  stations: StationDTO[]
  stationsById: Record<string, StationDTO>
  refreshStations: () => Promise<void>
  loading: boolean
  error: string | null
}

const StationsContext = createContext<StationsContextValue | null>(null)

function normalizeStation(station: StationDTO): StationDTO {
  return {
    ...station,
    createdAt: typeof station.createdAt === 'string' ? new Date(station.createdAt) : station.createdAt,
    updatedAt: typeof station.updatedAt === 'string' ? new Date(station.updatedAt) : station.updatedAt,
  }
}

export function StationsProvider({ children }: { children: ReactNode }) {
  const [stations, setStations] = useState<StationDTO[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refreshStations = useCallback(async () => {
    try {
      setError(null)
      const res = await stationsApi.list()
      setStations(res.data.map(normalizeStation))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stations')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshStations()
  }, [refreshStations])

  const stationsById = useMemo(
    () => Object.fromEntries(stations.map((s) => [s.id, s])),
    [stations]
  )

  return (
    <StationsContext.Provider value={{ stations, stationsById, refreshStations, loading, error }}>
      {children}
    </StationsContext.Provider>
  )
}

export function useStations(): StationsContextValue {
  const ctx = useContext(StationsContext)
  if (!ctx) throw new Error('useStations must be used within a StationsProvider')
  return ctx
}

