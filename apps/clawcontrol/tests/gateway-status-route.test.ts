import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getRepos: vi.fn(),
}))

vi.mock('@/lib/repo', () => ({
  getRepos: mocks.getRepos,
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getRepos.mockReset()
})

describe('gateway status route', () => {
  it('returns the repository gateway status response as-is', async () => {
    const status = vi.fn().mockResolvedValue({
      status: 'ok',
      latencyMs: 17,
      data: {
        running: true,
        version: '2026.2.9',
      },
      error: null,
      timestamp: '2026-02-11T00:00:00.000Z',
      cached: false,
    })

    mocks.getRepos.mockReturnValue({
      gateway: { status },
    })

    const route = await import('@/app/api/openclaw/gateway/status/route')
    const response = await route.GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toEqual({
      status: 'ok',
      latencyMs: 17,
      data: {
        running: true,
        version: '2026.2.9',
      },
      error: null,
      timestamp: '2026-02-11T00:00:00.000Z',
      cached: false,
    })
    expect(status).toHaveBeenCalledTimes(1)
  })

  it('preserves degraded auth-required results from repository', async () => {
    const status = vi.fn().mockResolvedValue({
      status: 'degraded',
      latencyMs: 25,
      data: {
        running: true,
      },
      error: 'Gateway reachable, authentication required',
      timestamp: '2026-02-11T00:00:00.000Z',
      cached: true,
      staleAgeMs: 523,
    })

    mocks.getRepos.mockReturnValue({
      gateway: { status },
    })

    const route = await import('@/app/api/openclaw/gateway/status/route')
    const response = await route.GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.status).toBe('degraded')
    expect(payload.error).toContain('authentication required')
    expect(payload.cached).toBe(true)
    expect(payload.staleAgeMs).toBe(523)
    expect(status).toHaveBeenCalledTimes(1)
  })

  it('preserves unavailable results from repository', async () => {
    const status = vi.fn().mockResolvedValue({
      status: 'unavailable',
      latencyMs: 3002,
      data: null,
      error: 'connect ECONNREFUSED 127.0.0.1:18789',
      timestamp: '2026-02-11T00:00:00.000Z',
      cached: false,
    })

    mocks.getRepos.mockReturnValue({
      gateway: { status },
    })

    const route = await import('@/app/api/openclaw/gateway/status/route')
    const response = await route.GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.status).toBe('unavailable')
    expect(payload.data).toBeNull()
    expect(payload.error).toContain('ECONNREFUSED')
    expect(status).toHaveBeenCalledTimes(1)
  })
})
