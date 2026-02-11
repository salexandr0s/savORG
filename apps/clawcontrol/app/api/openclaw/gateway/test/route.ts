import { NextResponse } from 'next/server'
import { probeGatewayHealth } from '@clawcontrol/adapters-openclaw'
import { getOpenClawConfig, waitForGatewayAvailability } from '@/lib/openclaw-client'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (LOOPBACK_HOSTS.has(normalized)) return true
  return /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

function isLoopbackUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return isLoopbackHostname(parsed.hostname)
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = (await request.json().catch(() => null)) as {
    gatewayHttpUrl?: unknown
    gatewayToken?: unknown
    withRetry?: unknown
  } | null

  const resolved = await getOpenClawConfig(true)

  const gatewayUrl =
    normalizeString(body?.gatewayHttpUrl)
    ?? resolved?.gatewayUrl
    ?? 'http://127.0.0.1:18789'

  if (!isLoopbackUrl(gatewayUrl)) {
    return NextResponse.json(
      {
        error: 'Gateway HTTP URL must use a loopback host (127.0.0.1, localhost, or ::1).',
        code: 'NON_LOOPBACK_FORBIDDEN',
      },
      { status: 400 }
    )
  }

  const token =
    normalizeString(body?.gatewayToken)
    ?? resolved?.token
    ?? null

  const withRetry = body?.withRetry === true

  if (withRetry) {
    const retry = await waitForGatewayAvailability(
      { gatewayUrl, token },
      [0, 1000, 2000, 4000, 8000]
    )

    return NextResponse.json({
      data: {
        gatewayUrl,
        tokenProvided: Boolean(token),
        reachable: retry.available,
        state: retry.state,
        attempts: retry.attempts,
        probe: retry.probe,
      },
    })
  }

  const probe = await probeGatewayHealth(gatewayUrl, token ?? undefined)
  return NextResponse.json({
    data: {
      gatewayUrl,
      tokenProvided: Boolean(token),
      reachable: probe.ok,
      state: probe.state,
      probe,
    },
  })
}
