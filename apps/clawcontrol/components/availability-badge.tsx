/**
 * Availability Badge Component
 *
 * Displays OpenClaw availability status with visual indicators.
 * Used in header/sidebar to give instant confidence when OpenClaw is flaky.
 */

import { type AvailabilityStatus } from '@/lib/openclaw/availability'

export interface AvailabilityBadgeProps {
  /** Current availability status */
  status: AvailabilityStatus
  /** Latency in milliseconds (optional) */
  latencyMs?: number
  /** Whether response was from cache */
  cached?: boolean
  /** If cached, how old the cached data is (ms) */
  staleAgeMs?: number
  /** Optional label prefix (e.g., "Gateway", "Cron") */
  label?: string
  /** Size variant */
  size?: 'sm' | 'md'
}

/**
 * Status indicator dot with appropriate color.
 */
function StatusDot({ status, size = 'md' }: { status: AvailabilityStatus; size?: 'sm' | 'md' }) {
  const sizeClasses = size === 'sm' ? 'h-2 w-2' : 'h-2.5 w-2.5'

  const colorClasses = {
    ok: 'bg-green-500',
    degraded: 'bg-yellow-500',
    unavailable: 'bg-red-500',
  }

  return (
    <span
      className={`inline-block rounded-full ${sizeClasses} ${colorClasses[status]}`}
      aria-hidden="true"
    />
  )
}

/**
 * Format latency for display.
 */
function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * Format stale age for display.
 */
function formatStaleAge(ms: number): string {
  if (ms < 1000) return 'just now'
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`
  return `${Math.floor(ms / 60000)}m ago`
}

/**
 * Availability Badge
 *
 * Displays availability status with visual feedback:
 * - ok: green dot
 * - degraded: yellow dot + "Slow (Xs)"
 * - unavailable: red dot + "Unavailable"
 * - cached: shows "(cached Xs ago)" suffix
 */
export function AvailabilityBadge({
  status,
  latencyMs,
  cached,
  staleAgeMs,
  label,
  size = 'md',
}: AvailabilityBadgeProps) {
  const textSizeClass = size === 'sm' ? 'text-xs' : 'text-sm'

  // Build status text
  let statusText: string
  switch (status) {
    case 'ok':
      statusText = latencyMs !== undefined ? formatLatency(latencyMs) : 'Connected'
      break
    case 'degraded':
      statusText = latencyMs !== undefined ? `Slow (${formatLatency(latencyMs)})` : 'Slow'
      break
    case 'unavailable':
      statusText = 'Unavailable'
      break
  }

  // Add cached suffix
  const cachedSuffix = cached && staleAgeMs !== undefined ? ` (cached ${formatStaleAge(staleAgeMs)})` : ''

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${textSizeClass}`}
      role="status"
      aria-label={`${label ? `${label} ` : ''}${status}${cachedSuffix}`}
    >
      <StatusDot status={status} size={size} />
      {label && <span className="font-medium text-gray-700 dark:text-gray-300">{label}:</span>}
      <span
        className={
          status === 'unavailable'
            ? 'text-red-600 dark:text-red-400'
            : status === 'degraded'
              ? 'text-yellow-600 dark:text-yellow-400'
              : 'text-gray-600 dark:text-gray-400'
        }
      >
        {statusText}
        {cachedSuffix && <span className="text-gray-400 dark:text-gray-500">{cachedSuffix}</span>}
      </span>
    </span>
  )
}

/**
 * Compact badge for use in tight spaces (e.g., table cells, lists).
 */
export function AvailabilityDot({ status }: { status: AvailabilityStatus }) {
  const titles = {
    ok: 'Connected',
    degraded: 'Slow response',
    unavailable: 'Unavailable',
  }

  return (
    <span title={titles[status]}>
      <StatusDot status={status} size="sm" />
    </span>
  )
}
