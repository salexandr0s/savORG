import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTailscaleReadinessReport: vi.fn(),
}))

vi.mock('@/lib/system/tailscale-readiness', () => ({
  getTailscaleReadinessReport: mocks.getTailscaleReadinessReport,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getTailscaleReadinessReport.mockReset()
})

describe('tailscale readiness route', () => {
  it('returns report payload', async () => {
    mocks.getTailscaleReadinessReport.mockResolvedValue({
      generatedAt: '2026-02-11T00:00:00.000Z',
      summary: { state: 'ok', ok: 3, warning: 0, error: 0, unknown: 0 },
      checks: [],
      context: {
        remoteAccessMode: 'tailscale_tunnel',
        gatewayUrl: 'http://127.0.0.1:18789',
        suggestedHost: 'host.tailnet.ts.net',
      },
      commands: {
        clawcontrolTunnel: 'ssh -L 3000:127.0.0.1:3000 <user>@host.tailnet.ts.net',
        gatewayTunnel: 'ssh -L 18789:127.0.0.1:18789 <user>@host.tailnet.ts.net',
      },
    })

    const route = await import('@/app/api/system/tailscale-readiness/route')
    const response = await route.GET()
    const payload = (await response.json()) as { data?: { summary?: { state?: string } } }

    expect(response.status).toBe(200)
    expect(payload.data?.summary?.state).toBe('ok')
  })

  it('returns 500 on internal failure', async () => {
    mocks.getTailscaleReadinessReport.mockRejectedValue(new Error('boom'))

    const route = await import('@/app/api/system/tailscale-readiness/route')
    const response = await route.GET()
    const payload = (await response.json()) as { error?: string }

    expect(response.status).toBe(500)
    expect(payload.error).toBe('boom')
  })
})
