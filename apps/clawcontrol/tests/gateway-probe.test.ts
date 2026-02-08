import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('gateway probe classification', () => {
  it('classifies 2xx responses as reachable', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
    })

    vi.stubGlobal('fetch', mockFetch)

    const mod = await import('../../../packages/adapters-openclaw/src/discovery')
    const result = await mod.probeGatewayHealth('http://127.0.0.1:18789')

    expect(result.ok).toBe(true)
    expect(result.state).toBe('reachable')
    expect(result.statusCode).toBe(200)
  })

  it('classifies 401 responses as auth_required', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 401,
    })

    vi.stubGlobal('fetch', mockFetch)

    const mod = await import('../../../packages/adapters-openclaw/src/discovery')
    const result = await mod.probeGatewayHealth('http://127.0.0.1:18789', 'token')

    expect(result.ok).toBe(false)
    expect(result.state).toBe('auth_required')
    expect(result.statusCode).toBe(401)
  })

  it('classifies network errors as unreachable', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED'))

    vi.stubGlobal('fetch', mockFetch)

    const mod = await import('../../../packages/adapters-openclaw/src/discovery')
    const result = await mod.probeGatewayHealth('http://127.0.0.1:18789')

    expect(result.ok).toBe(false)
    expect(result.state).toBe('unreachable')
    expect(result.error).toContain('ECONNREFUSED')
  })
})
