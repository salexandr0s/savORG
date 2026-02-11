import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  runCommandJson: vi.fn(),
  probeGatewayHealth: vi.fn(),
  getOpenClawConfig: vi.fn(),
  getOpenClawConfigSync: vi.fn(),
}))

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  runCommandJson: mocks.runCommandJson,
  probeGatewayHealth: mocks.probeGatewayHealth,
}))

vi.mock('@/lib/openclaw-client', () => ({
  getOpenClawConfig: mocks.getOpenClawConfig,
  getOpenClawConfigSync: mocks.getOpenClawConfigSync,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.runCommandJson.mockReset()
  mocks.probeGatewayHealth.mockReset()
  mocks.getOpenClawConfig.mockReset()
  mocks.getOpenClawConfigSync.mockReset()
  mocks.getOpenClawConfigSync.mockReturnValue(null)
})

describe('gateway repo', () => {
  it('returns ok when probe is reachable even if CLI JSON enrichment fails', async () => {
    mocks.getOpenClawConfig.mockResolvedValue({
      gatewayUrl: 'http://127.0.0.1:18789',
      token: null,
    })
    mocks.probeGatewayHealth.mockResolvedValue({
      ok: true,
      state: 'reachable',
      url: 'http://127.0.0.1:18789/health',
      latencyMs: 12,
      statusCode: 200,
    })
    mocks.runCommandJson.mockResolvedValue({
      error: 'Failed to parse JSON output',
      exitCode: 0,
    })

    const mod = await import('@/lib/repo/gateway')
    const repo = mod.createCliGatewayRepo()
    const status = await repo.status()

    expect(status.status).toBe('ok')
    expect(status.error).toBeNull()
    expect(status.data?.running).toBe(true)
    expect(mocks.runCommandJson).toHaveBeenCalledWith(
      'status.noprobe.json',
      expect.objectContaining({
        timeout: expect.any(Number),
      })
    )
  })

  it('returns unavailable when probe cannot reach the gateway', async () => {
    mocks.getOpenClawConfig.mockResolvedValue({
      gatewayUrl: 'http://127.0.0.1:18789',
      token: null,
    })
    mocks.probeGatewayHealth.mockResolvedValue({
      ok: false,
      state: 'unreachable',
      url: 'http://127.0.0.1:18789/health',
      latencyMs: 8,
      error: 'connect ECONNREFUSED',
    })

    const mod = await import('@/lib/repo/gateway')
    const repo = mod.createCliGatewayRepo()
    const status = await repo.status()

    expect(status.status).toBe('unavailable')
    expect(status.data).toBeNull()
    expect(status.error).toContain('ECONNREFUSED')
  })
})
