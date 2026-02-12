import { describe, expect, it } from 'vitest'
import type { ParsedErrorEvent } from '@/lib/openclaw/error-parser'
import {
  addEventToDeltaMaps,
  buildZeroFilledTrend,
  computeSpikeMetrics,
  createErrorDeltaMaps,
  dayStart,
} from '@/lib/openclaw/error-sync'

function event(input: {
  day: string
  signatureHash: string
  signatureText?: string
}): ParsedErrorEvent {
  const occurredAt = new Date(input.day)
  return {
    occurredAt,
    signatureHash: input.signatureHash,
    signatureText: input.signatureText ?? `sig-${input.signatureHash}`,
    sample: `sample-${input.signatureHash}`,
    sampleRawRedacted: `raw-${input.signatureHash}`,
  }
}

describe('error-sync delta maps', () => {
  it('aggregates per-signature and per-day counts', () => {
    const maps = createErrorDeltaMaps()

    addEventToDeltaMaps(maps, event({ day: '2026-02-10T01:00:00.000Z', signatureHash: 'aaa' }))
    addEventToDeltaMaps(maps, event({ day: '2026-02-10T02:00:00.000Z', signatureHash: 'aaa' }))
    addEventToDeltaMaps(maps, event({ day: '2026-02-11T01:00:00.000Z', signatureHash: 'aaa' }))
    addEventToDeltaMaps(maps, event({ day: '2026-02-10T03:00:00.000Z', signatureHash: 'bbb' }))

    expect(maps.signatureDeltas.get('aaa')?.count).toBe(3n)
    expect(maps.signatureDeltas.get('bbb')?.count).toBe(1n)
    expect(maps.dayDeltas.get('2026-02-10T00:00:00.000Z')).toBe(3n)
    expect(maps.dayDeltas.get('2026-02-11T00:00:00.000Z')).toBe(1n)
    expect(maps.signatureDayDeltas.get('aaa::2026-02-10T00:00:00.000Z')?.count).toBe(2n)
    expect(maps.signatureDayDeltas.get('aaa::2026-02-11T00:00:00.000Z')?.count).toBe(1n)
  })

  it('supports windowed top-signature ranking input via signature-day deltas', () => {
    const maps = createErrorDeltaMaps()

    addEventToDeltaMaps(maps, event({ day: '2026-02-08T03:00:00.000Z', signatureHash: 'hot' }))
    addEventToDeltaMaps(maps, event({ day: '2026-02-08T03:05:00.000Z', signatureHash: 'hot' }))
    addEventToDeltaMaps(maps, event({ day: '2026-02-09T03:00:00.000Z', signatureHash: 'hot' }))
    addEventToDeltaMaps(maps, event({ day: '2026-02-09T03:00:00.000Z', signatureHash: 'warm' }))

    const ranked = Array.from(maps.signatureDayDeltas.values())
      .reduce<Map<string, bigint>>((acc, row) => {
        acc.set(row.signatureHash, (acc.get(row.signatureHash) ?? 0n) + row.count)
        return acc
      }, new Map())

    expect(ranked.get('hot')).toBe(3n)
    expect(ranked.get('warm')).toBe(1n)
  })

  it('zero-fills trend days and computes spike baseline correctly', () => {
    const from = dayStart(new Date('2026-02-01T12:00:00.000Z'))

    const trend = buildZeroFilledTrend(from, 9, [
      { day: new Date('2026-02-01T00:00:00.000Z'), count: 2n },
      { day: new Date('2026-02-02T00:00:00.000Z'), count: 2n },
      { day: new Date('2026-02-03T00:00:00.000Z'), count: 2n },
      { day: new Date('2026-02-04T00:00:00.000Z'), count: 2n },
      { day: new Date('2026-02-05T00:00:00.000Z'), count: 2n },
      { day: new Date('2026-02-06T00:00:00.000Z'), count: 2n },
      { day: new Date('2026-02-07T00:00:00.000Z'), count: 2n },
      { day: new Date('2026-02-08T00:00:00.000Z'), count: 8n },
      // 2026-02-09 intentionally omitted (today) to verify zero-fill.
    ])

    expect(trend).toHaveLength(9)
    expect(trend[8]?.count).toBe('0')

    const spike = computeSpikeMetrics(trend)
    expect(spike.yesterdayCount).toBe(8)
    expect(spike.baseline).toBe(2)
    expect(spike.detected).toBe(false)
  })
})
