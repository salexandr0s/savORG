import { describe, it, expect } from 'vitest'
import {
  normalizeErrorSignature,
  sanitizeErrorSample,
  sanitizeRawErrorSample,
  redactSensitiveErrorText,
} from '@/lib/openclaw/error-signatures'

describe('error-signatures', () => {
  it('normalizes volatile values into stable signature', () => {
    const a = normalizeErrorSignature(`2026-02-06T12:00:00Z ERROR Request 12345 failed\n at foo (/tmp/a.ts:33:9)`)
    const b = normalizeErrorSignature(`2026-02-07T12:10:00Z ERROR Request 67890 failed\n at foo (/tmp/b.ts:87:11)`)

    expect(a.signatureHash).toBe(b.signatureHash)
    expect(a.signatureText).toContain('<ts>')
  })

  it('sanitizes control chars and truncates samples', () => {
    const sample = sanitizeErrorSample('hello\u0000world\n'.repeat(80), 50)
    expect(sample.includes('\u0000')).toBe(false)
    expect(sample.length).toBeLessThanOrEqual(50)
  })

  it('produces raw redacted sample output for display toggle', () => {
    const normalized = normalizeErrorSignature(
      'ERROR auth failed\\nAuthorization: Bearer super-secret-token\\nRun: openclaw doctor --fix'
    )

    expect(normalized.rawSampleRedacted).toContain('[REDACTED_TOKEN]')
    expect(normalized.rawSampleRedacted).toContain('Run: openclaw doctor --fix')
  })

  it('redacts common secret patterns in raw mode', () => {
    const input = [
      'api_key=sk_12345678901234567890123456789012',
      'token: ghp_1234567890abcdefghijklmnopqrstuv',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturepayload',
    ].join('\n')

    const redacted = redactSensitiveErrorText(input)
    const sample = sanitizeRawErrorSample(input, 600)

    expect(redacted).toContain('[REDACTED_TOKEN]')
    expect(redacted).toContain('[REDACTED_JWT]')
    expect(sample).not.toContain('sk_123456')
  })
})
