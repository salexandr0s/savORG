import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  probeGatewayHealth: vi.fn(),
  getOpenClawConfig: vi.fn(),
  waitForGatewayAvailability: vi.fn(),
  verifyOperatorRequest: vi.fn(),
  asAuthErrorResponse: vi.fn(),
}))

vi.mock('@clawcontrol/adapters-openclaw', () => ({
  probeGatewayHealth: mocks.probeGatewayHealth,
}))

vi.mock('@/lib/openclaw-client', () => ({
  getOpenClawConfig: mocks.getOpenClawConfig,
  waitForGatewayAvailability: mocks.waitForGatewayAvailability,
}))

vi.mock('@/lib/auth/operator-auth', () => ({
  verifyOperatorRequest: mocks.verifyOperatorRequest,
  asAuthErrorResponse: mocks.asAuthErrorResponse,
}))

beforeEach(() => {
  vi.resetModules()

  mocks.probeGatewayHealth.mockReset()
  mocks.getOpenClawConfig.mockReset()
  mocks.waitForGatewayAvailability.mockReset()
  mocks.verifyOperatorRequest.mockReset()
  mocks.asAuthErrorResponse.mockReset()

  mocks.verifyOperatorRequest.mockReturnValue({
    ok: true,
    principal: {
      actor: 'user:operator',
      actorType: 'user',
      actorId: 'operator',
      sessionId: 'session-1',
    },
  })

  mocks.asAuthErrorResponse.mockImplementation((result: { error: string; code: string }) => ({
    error: result.error,
    code: result.code,
  }))

  mocks.getOpenClawConfig.mockResolvedValue({
    gatewayUrl: 'http://127.0.0.1:18789',
    token: 'resolved-token',
  })

  mocks.probeGatewayHealth.mockResolvedValue({
    ok: true,
    state: 'reachable',
    url: 'http://127.0.0.1:18789/health',
    latencyMs: 12,
    statusCode: 200,
  })

  mocks.waitForGatewayAvailability.mockResolvedValue({
    available: true,
    state: 'reachable',
    attempts: 2,
    probe: {
      ok: true,
      state: 'reachable',
      url: 'http://127.0.0.1:18789/health',
      latencyMs: 8,
      statusCode: 200,
    },
  })
})

describe('gateway test route', () => {
  it('rejects unauthenticated requests', async () => {
    mocks.verifyOperatorRequest.mockReturnValueOnce({
      ok: false,
      status: 401,
      code: 'AUTH_REQUIRED',
      error: 'Operator session is required',
    })

    const route = await import('@/app/api/openclaw/gateway/test/route')
    const request = new NextRequest('http://localhost/api/openclaw/gateway/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const response = await route.POST(request)
    const payload = (await response.json()) as { code?: string; error?: string }

    expect(response.status).toBe(401)
    expect(payload.code).toBe('AUTH_REQUIRED')
    expect(mocks.getOpenClawConfig).not.toHaveBeenCalled()
  })

  it('rejects non-loopback gateway URL from request body', async () => {
    const route = await import('@/app/api/openclaw/gateway/test/route')
    const request = new NextRequest('http://localhost/api/openclaw/gateway/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gatewayHttpUrl: 'http://example.com:18789' }),
    })

    const response = await route.POST(request)
    const payload = (await response.json()) as { code?: string; error?: string }

    expect(response.status).toBe(400)
    expect(payload.code).toBe('NON_LOOPBACK_FORBIDDEN')
    expect(payload.error).toContain('loopback')
    expect(mocks.probeGatewayHealth).not.toHaveBeenCalled()
    expect(mocks.waitForGatewayAvailability).not.toHaveBeenCalled()
  })

  it('rejects non-loopback gateway URL from resolved config', async () => {
    mocks.getOpenClawConfig.mockResolvedValueOnce({
      gatewayUrl: 'https://gateway.remote.example',
      token: 'resolved-token',
    })

    const route = await import('@/app/api/openclaw/gateway/test/route')
    const request = new NextRequest('http://localhost/api/openclaw/gateway/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const response = await route.POST(request)
    const payload = (await response.json()) as { code?: string; error?: string }

    expect(response.status).toBe(400)
    expect(payload.code).toBe('NON_LOOPBACK_FORBIDDEN')
    expect(mocks.probeGatewayHealth).not.toHaveBeenCalled()
    expect(mocks.waitForGatewayAvailability).not.toHaveBeenCalled()
  })

  it('uses retry path when requested', async () => {
    const route = await import('@/app/api/openclaw/gateway/test/route')
    const request = new NextRequest('http://localhost/api/openclaw/gateway/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gatewayHttpUrl: 'http://127.0.0.1:18789',
        withRetry: true,
      }),
    })

    const response = await route.POST(request)
    const payload = (await response.json()) as {
      data: {
        state: string
        attempts: number
      }
    }

    expect(response.status).toBe(200)
    expect(payload.data.state).toBe('reachable')
    expect(payload.data.attempts).toBe(2)
    expect(mocks.waitForGatewayAvailability).toHaveBeenCalledTimes(1)
    expect(mocks.probeGatewayHealth).not.toHaveBeenCalled()
  })

  it('uses direct probe path when retry is not requested', async () => {
    const route = await import('@/app/api/openclaw/gateway/test/route')
    const request = new NextRequest('http://localhost/api/openclaw/gateway/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gatewayHttpUrl: 'http://127.0.0.1:18789',
      }),
    })

    const response = await route.POST(request)
    const payload = (await response.json()) as {
      data: {
        reachable: boolean
        state: string
      }
    }

    expect(response.status).toBe(200)
    expect(payload.data.reachable).toBe(true)
    expect(payload.data.state).toBe('reachable')
    expect(mocks.probeGatewayHealth).toHaveBeenCalledTimes(1)
    expect(mocks.waitForGatewayAvailability).not.toHaveBeenCalled()
  })
})
