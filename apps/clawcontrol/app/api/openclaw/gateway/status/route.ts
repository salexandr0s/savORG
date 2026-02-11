import { NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import type { OpenClawResponse } from '@/lib/openclaw/availability'
import type { GatewayStatusDTO } from '@/lib/repo/gateway'

/**
 * GET /api/openclaw/gateway/status
 *
 * Returns gateway status with explicit availability semantics.
 * Delegates to the repository implementation to keep behavior consistent
 * with maintenance and other gateway surfaces.
 */
export async function GET(): Promise<NextResponse<OpenClawResponse<GatewayStatusDTO>>> {
  const response = await getRepos().gateway.status()
  return NextResponse.json(response)
}
