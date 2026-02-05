'use client'

import { cn } from '@/lib/utils'
import { useStations } from '@/lib/stations-context'
import { isStationIconKey, STATION_ICON_COMPONENTS } from '@/lib/stations/icon-map'

export function StationIcon({
  stationId,
  size = 'sm',
  className,
}: {
  stationId?: string | null
  size?: 'sm' | 'md'
  className?: string
}) {
  const { stationsById } = useStations()
  const station = stationId ? stationsById[stationId] : undefined

  const Icon = isStationIconKey(station?.icon)
    ? STATION_ICON_COMPONENTS[station.icon]
    : STATION_ICON_COMPONENTS.tag

  const sizeClass = size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5'

  return (
    <Icon
      className={cn(
        sizeClass,
        station ? 'text-fg-1' : 'text-fg-3',
        className
      )}
      color={station?.color ?? undefined}
      aria-hidden
    />
  )
}
