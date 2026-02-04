/**
 * OpenClaw Availability Types
 *
 * All OpenClaw-backed data uses these types to express explicit availability status.
 * clawcontrol never silently falls back to mocks in always-on mode.
 */

export type AvailabilityStatus = 'ok' | 'degraded' | 'unavailable'

/**
 * Standard response wrapper for all OpenClaw-backed data.
 *
 * @template T - The data type when available
 */
export interface OpenClawResponse<T> {
  /** Current availability status */
  status: AvailabilityStatus
  /** Time taken to fetch the data (ms) */
  latencyMs: number
  /** The data payload (null if unavailable) */
  data: T | null
  /** Error message if status is 'unavailable' */
  error: string | null
  /** ISO timestamp when this response was generated */
  timestamp: string
  /** Whether this response was served from cache */
  cached: boolean
  /** If cached, how old the cached data is (ms) */
  staleAgeMs?: number
}

/** Maximum time to wait for OpenClaw CLI commands (2 minutes for slow cron ops) */
export const OPENCLAW_TIMEOUT_MS = 120_000

/** Latency threshold above which status becomes 'degraded' */
export const DEGRADED_THRESHOLD_MS = 30_000

/** Cache TTL to prevent refresh cascade (15 seconds) */
export const CACHE_TTL_MS = 15_000

/**
 * Create a successful OpenClaw response.
 */
export function okResponse<T>(data: T, latencyMs: number, cached = false, staleAgeMs?: number): OpenClawResponse<T> {
  return {
    status: latencyMs > DEGRADED_THRESHOLD_MS ? 'degraded' : 'ok',
    latencyMs,
    data,
    error: null,
    timestamp: new Date().toISOString(),
    cached,
    ...(staleAgeMs !== undefined ? { staleAgeMs } : {}),
  }
}

/**
 * Create an unavailable OpenClaw response.
 */
export function unavailableResponse<T>(error: string, latencyMs: number): OpenClawResponse<T> {
  return {
    status: 'unavailable',
    latencyMs,
    data: null,
    error,
    timestamp: new Date().toISOString(),
    cached: false,
  }
}

/**
 * Simple in-memory cache for OpenClaw responses.
 * Prevents cascade when calls are slow.
 */
const cache = new Map<string, { data: OpenClawResponse<unknown>; cachedAt: number }>()

/**
 * Get a cached response if it exists and is still fresh.
 */
export function getCached<T>(key: string): OpenClawResponse<T> | null {
  const entry = cache.get(key)
  if (!entry) return null

  const age = Date.now() - entry.cachedAt
  if (age > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }

  return {
    ...(entry.data as OpenClawResponse<T>),
    cached: true,
    staleAgeMs: age,
  }
}

/**
 * Set a cache entry.
 */
export function setCache<T>(key: string, response: OpenClawResponse<T>): void {
  cache.set(key, { data: response, cachedAt: Date.now() })
}

/**
 * Clear a specific cache entry or all entries.
 */
export function clearCache(key?: string): void {
  if (key) {
    cache.delete(key)
  } else {
    cache.clear()
  }
}
