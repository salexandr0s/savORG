import { NextResponse } from 'next/server'
import { probeGatewayHealth } from '@clawcontrol/adapters-openclaw'
import { getOpenClawConfig, waitForGatewayAvailability } from '@/lib/openclaw-client'

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function POST(request: Request) {
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
