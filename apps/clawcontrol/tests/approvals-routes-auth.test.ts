import { describe, expect, it } from 'vitest'

describe('approvals routes auth', () => {
  it('rejects approval creation without operator session', async () => {
    const route = await import('@/app/api/approvals/route')
    const request = new Request('http://localhost/api/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workOrderId: 'wo_1',
        type: 'scope_change',
        questionMd: 'Approve?',
      }),
    })

    const response = await route.POST(request as unknown as import('next/server').NextRequest)
    const payload = (await response.json()) as { code?: string }

    expect(response.status).toBe(401)
    expect(payload.code).toBe('AUTH_REQUIRED')
  })

  it('rejects batch approval resolution without operator session', async () => {
    const route = await import('@/app/api/approvals/batch/route')
    const request = new Request('http://localhost/api/approvals/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ids: ['ap_1'],
        status: 'approved',
      }),
    })

    const response = await route.POST(request as unknown as import('next/server').NextRequest)
    const payload = (await response.json()) as { code?: string }

    expect(response.status).toBe(401)
    expect(payload.code).toBe('AUTH_REQUIRED')
  })
})
