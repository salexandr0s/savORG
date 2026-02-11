/**
 * Runtime dependency contract for OpenClaw CLI-backed features.
 *
 * This centralizes the current resolved CLI binary and latest availability check.
 */

import {
  checkOpenClaw,
  getCachedCheck,
  getOpenClawBin,
  getOpenClawCheckTimestampMs,
  getOpenClawCheckCacheTtlMs,
  clearCache as clearOpenClawCheckCache,
} from '@clawcontrol/adapters-openclaw'

export interface OpenClawRuntimeDependencyStatus {
  cliAvailable: boolean
  cliVersion: string | null
  cliError?: string
  belowMinVersion?: boolean
  resolvedCliBin: string
  checkedAt: string | null
  cacheTtlMs: number
}

export async function getOpenClawRuntimeDependencyStatus(
  options: { refresh?: boolean } = {}
): Promise<OpenClawRuntimeDependencyStatus> {
  if (options.refresh) {
    clearOpenClawCheckCache()
  }

  const check = await checkOpenClaw()
  const checkedAtMs = getOpenClawCheckTimestampMs()

  return {
    cliAvailable: check.available,
    cliVersion: check.version,
    ...(check.error ? { cliError: check.error } : {}),
    ...(check.belowMinVersion !== undefined ? { belowMinVersion: check.belowMinVersion } : {}),
    resolvedCliBin: getOpenClawBin(),
    checkedAt: checkedAtMs ? new Date(checkedAtMs).toISOString() : null,
    cacheTtlMs: getOpenClawCheckCacheTtlMs(),
  }
}

export function getCachedOpenClawRuntimeDependencyStatus(): OpenClawRuntimeDependencyStatus | null {
  const check = getCachedCheck()
  if (!check) return null

  const checkedAtMs = getOpenClawCheckTimestampMs()
  return {
    cliAvailable: check.available,
    cliVersion: check.version,
    ...(check.error ? { cliError: check.error } : {}),
    ...(check.belowMinVersion !== undefined ? { belowMinVersion: check.belowMinVersion } : {}),
    resolvedCliBin: getOpenClawBin(),
    checkedAt: checkedAtMs ? new Date(checkedAtMs).toISOString() : null,
    cacheTtlMs: getOpenClawCheckCacheTtlMs(),
  }
}
