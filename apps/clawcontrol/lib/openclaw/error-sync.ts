import 'server-only'

import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { prisma } from '@/lib/db'
import { parseGatewayErrorLog, type ParsedErrorEvent } from './error-parser'
import { classifyErrorSignature, type ErrorClassification } from './error-classifier'

export interface ErrorSyncStats {
  processedEvents: number
  signaturesUpdated: number
  daysUpdated: number
  cursorReset: boolean
  durationMs: number
}

export interface ErrorSignatureInsightSnapshot {
  status: 'pending' | 'ready' | 'failed'
  diagnosisMd: string | null
  failureReason: string | null
  generatedAt: string | null
  sourceAgentId: string | null
  sourceAgentName: string | null
}

export interface ErrorSignatureListItem {
  signatureHash: string
  signatureText: string
  count: string
  windowCount: string
  allTimeCount: string
  firstSeen: string
  lastSeen: string
  sample: string
  rawRedactedSample?: string
  classification: ErrorClassification
  insight: ErrorSignatureInsightSnapshot | null
}

export interface ListErrorSignaturesResult {
  generatedAt: string
  from: string
  to: string
  days: number
  signatures: ErrorSignatureListItem[]
  meta: {
    limit: number
    includeRaw: boolean
    windowUniqueSignatures: number
  }
}

export interface ErrorSummaryResult {
  generatedAt: string
  from: string
  to: string
  trend: Array<{ day: string; count: string }>
  totals: {
    totalErrors: string
    uniqueSignatures: number
    windowUniqueSignatures: number
  }
  topSignatures: ErrorSignatureListItem[]
  spike: {
    detected: boolean
    yesterdayCount: number
    baseline: number
  }
}

interface SignatureDelta {
  signatureText: string
  sample: string
  rawSampleRedacted: string
  count: bigint
  firstSeen: Date
  lastSeen: Date
}

interface SignatureDayDelta {
  signatureHash: string
  day: Date
  count: bigint
}

export interface ErrorDeltaMaps {
  signatureDeltas: Map<string, SignatureDelta>
  dayDeltas: Map<string, bigint>
  signatureDayDeltas: Map<string, SignatureDayDelta>
}

function getGatewayErrorLogPath(): string {
  return join(process.env.OPENCLAW_HOME || join(homedir(), '.openclaw'), 'logs', 'gateway.err.log')
}

function toBigInt(value: number | bigint): bigint {
  if (typeof value === 'bigint') return value
  if (!Number.isFinite(value)) return 0n
  return BigInt(Math.trunc(value))
}

function deriveFingerprint(stat: {
  dev: number | bigint
  ino: number | bigint
  size: number | bigint
  mtimeMs: number
}) {
  return {
    deviceId: toBigInt(stat.dev),
    inode: toBigInt(stat.ino),
    fileSizeBytes: toBigInt(stat.size),
    fileMtimeMs: toBigInt(stat.mtimeMs),
  }
}

function shouldResetCursor(
  cursor: {
    deviceId: bigint
    inode: bigint
    offsetBytes: bigint
    fileMtimeMs: bigint
    fileSizeBytes: bigint
  },
  next: {
    deviceId: bigint
    inode: bigint
    fileSizeBytes: bigint
    fileMtimeMs: bigint
  }
): boolean {
  if (cursor.deviceId !== next.deviceId) return true
  if (cursor.inode !== next.inode) return true
  if (next.fileSizeBytes < cursor.offsetBytes) return true
  if (next.fileMtimeMs < cursor.fileMtimeMs && next.fileSizeBytes !== cursor.fileSizeBytes) return true
  return false
}

export function dayStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function dateRangeFromDays(days: number): { from: Date; to: Date } {
  const toDay = dayStart(new Date())
  const from = new Date(toDay)
  from.setUTCDate(from.getUTCDate() - Math.max(1, days) + 1)
  return { from, to: new Date(toDay.getTime() + 86400_000 - 1) }
}

function isoDayRange(from: Date, days: number): string[] {
  const out: string[] = []
  for (let i = 0; i < days; i += 1) {
    const d = new Date(from)
    d.setUTCDate(d.getUTCDate() + i)
    out.push(d.toISOString())
  }
  return out
}

export function buildZeroFilledTrend(
  from: Date,
  days: number,
  rows: Array<{ day: Date; count: bigint }>
): Array<{ day: string; count: string }> {
  const byDay = new Map<string, bigint>()
  for (const row of rows) {
    byDay.set(dayStart(row.day).toISOString(), row.count)
  }

  return isoDayRange(from, days).map((dayIso) => ({
    day: dayIso,
    count: (byDay.get(dayIso) ?? 0n).toString(),
  }))
}

export function computeSpikeMetrics(
  trend: Array<{ day: string; count: string }>
): { detected: boolean; yesterdayCount: number; baseline: number } {
  if (trend.length === 0) {
    return { detected: false, yesterdayCount: 0, baseline: 0 }
  }

  const values = trend.map((item) => Number(item.count))
  const todayIndex = values.length - 1
  const yesterdayIndex = todayIndex - 1

  if (yesterdayIndex < 0) {
    return { detected: false, yesterdayCount: 0, baseline: 0 }
  }

  const yesterdayCount = values[yesterdayIndex] ?? 0
  const baselineStart = Math.max(0, yesterdayIndex - 7)
  const baselineValues = values.slice(baselineStart, yesterdayIndex)
  const baseline = baselineValues.length > 0
    ? baselineValues.reduce((sum, value) => sum + value, 0) / baselineValues.length
    : 0

  const detected = baseline >= 3 && yesterdayCount >= baseline * 2

  return {
    detected,
    yesterdayCount,
    baseline: Math.round(baseline * 100) / 100,
  }
}

export function createErrorDeltaMaps(): ErrorDeltaMaps {
  return {
    signatureDeltas: new Map<string, SignatureDelta>(),
    dayDeltas: new Map<string, bigint>(),
    signatureDayDeltas: new Map<string, SignatureDayDelta>(),
  }
}

export function addEventToDeltaMaps(maps: ErrorDeltaMaps, event: ParsedErrorEvent): void {
  const prevSig = maps.signatureDeltas.get(event.signatureHash)
  if (!prevSig) {
    maps.signatureDeltas.set(event.signatureHash, {
      signatureText: event.signatureText,
      sample: event.sample,
      rawSampleRedacted: event.sampleRawRedacted,
      count: 1n,
      firstSeen: event.occurredAt,
      lastSeen: event.occurredAt,
    })
  } else {
    prevSig.count += 1n
    prevSig.signatureText = event.signatureText || prevSig.signatureText
    prevSig.sample = event.sample || prevSig.sample
    prevSig.rawSampleRedacted = event.sampleRawRedacted || prevSig.rawSampleRedacted
    if (event.occurredAt < prevSig.firstSeen) prevSig.firstSeen = event.occurredAt
    if (event.occurredAt > prevSig.lastSeen) prevSig.lastSeen = event.occurredAt
    maps.signatureDeltas.set(event.signatureHash, prevSig)
  }

  const dayIso = dayStart(event.occurredAt).toISOString()
  maps.dayDeltas.set(dayIso, (maps.dayDeltas.get(dayIso) ?? 0n) + 1n)

  const signatureDayKey = `${event.signatureHash}::${dayIso}`
  const prevSignatureDay = maps.signatureDayDeltas.get(signatureDayKey)
  if (!prevSignatureDay) {
    maps.signatureDayDeltas.set(signatureDayKey, {
      signatureHash: event.signatureHash,
      day: new Date(dayIso),
      count: 1n,
    })
  } else {
    prevSignatureDay.count += 1n
    maps.signatureDayDeltas.set(signatureDayKey, prevSignatureDay)
  }
}

function toInsightSnapshot(row: {
  status: string
  diagnosisMd: string
  failureReason: string | null
  generatedAt: Date | null
  sourceAgentId: string | null
  sourceAgentName: string | null
} | null): ErrorSignatureInsightSnapshot | null {
  if (!row) return null
  return {
    status: row.status === 'ready' || row.status === 'failed' ? row.status : 'pending',
    diagnosisMd: row.status === 'ready' ? row.diagnosisMd : null,
    failureReason: row.failureReason,
    generatedAt: row.generatedAt ? row.generatedAt.toISOString() : null,
    sourceAgentId: row.sourceAgentId,
    sourceAgentName: row.sourceAgentName,
  }
}

export async function syncErrorLog(): Promise<ErrorSyncStats> {
  const startedAt = Date.now()
  const sourcePath = getGatewayErrorLogPath()

  let stat: Awaited<ReturnType<typeof fsp.stat>>
  try {
    stat = await fsp.stat(sourcePath, { bigint: true })
  } catch {
    return {
      processedEvents: 0,
      signaturesUpdated: 0,
      daysUpdated: 0,
      cursorReset: false,
      durationMs: Date.now() - startedAt,
    }
  }

  const fingerprint = deriveFingerprint({
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: Number(stat.mtimeMs),
  })

  const cursor = await prisma.errorIngestionCursor.findUnique({
    where: { sourcePath },
  })

  const cursorReset = cursor
    ? shouldResetCursor(cursor, fingerprint)
    : false

  const offsetBytes = cursorReset ? 0n : (cursor?.offsetBytes ?? 0n)

  if (fingerprint.fileSizeBytes <= offsetBytes) {
    await prisma.errorIngestionCursor.upsert({
      where: { sourcePath },
      create: {
        sourcePath,
        deviceId: fingerprint.deviceId,
        inode: fingerprint.inode,
        offsetBytes: fingerprint.fileSizeBytes,
        fileMtimeMs: fingerprint.fileMtimeMs,
        fileSizeBytes: fingerprint.fileSizeBytes,
      },
      update: {
        deviceId: fingerprint.deviceId,
        inode: fingerprint.inode,
        offsetBytes: fingerprint.fileSizeBytes,
        fileMtimeMs: fingerprint.fileMtimeMs,
        fileSizeBytes: fingerprint.fileSizeBytes,
      },
    })

    return {
      processedEvents: 0,
      signaturesUpdated: 0,
      daysUpdated: 0,
      cursorReset,
      durationMs: Date.now() - startedAt,
    }
  }

  const deltaMaps = createErrorDeltaMaps()
  let processedEvents = 0

  await parseGatewayErrorLog(sourcePath, offsetBytes, (event: ParsedErrorEvent) => {
    processedEvents += 1
    addEventToDeltaMaps(deltaMaps, event)
  })

  let signaturesUpdated = 0
  for (const [signatureHash, delta] of deltaMaps.signatureDeltas.entries()) {
    const existing = await prisma.errorSignatureAggregate.findUnique({
      where: { signatureHash },
    })

    if (!existing) {
      await prisma.errorSignatureAggregate.create({
        data: {
          signatureHash,
          signatureText: delta.signatureText,
          count: delta.count,
          firstSeenAt: delta.firstSeen,
          lastSeenAt: delta.lastSeen,
          lastSampleSanitized: delta.sample,
          lastSampleRawRedacted: delta.rawSampleRedacted,
        },
      })
    } else {
      await prisma.errorSignatureAggregate.update({
        where: { signatureHash },
        data: {
          signatureText: delta.signatureText,
          count: existing.count + delta.count,
          firstSeenAt: existing.firstSeenAt < delta.firstSeen ? existing.firstSeenAt : delta.firstSeen,
          lastSeenAt: existing.lastSeenAt > delta.lastSeen ? existing.lastSeenAt : delta.lastSeen,
          lastSampleSanitized: delta.sample || existing.lastSampleSanitized,
          lastSampleRawRedacted: delta.rawSampleRedacted || existing.lastSampleRawRedacted,
        },
      })
    }

    signaturesUpdated += 1
  }

  let daysUpdated = 0
  for (const [dayIso, count] of deltaMaps.dayDeltas.entries()) {
    const day = new Date(dayIso)

    const existing = await prisma.errorDailyAggregate.findUnique({
      where: { day },
    })

    if (!existing) {
      await prisma.errorDailyAggregate.create({
        data: { day, count },
      })
    } else {
      await prisma.errorDailyAggregate.update({
        where: { day },
        data: { count: existing.count + count },
      })
    }

    daysUpdated += 1
  }

  for (const signatureDayDelta of deltaMaps.signatureDayDeltas.values()) {
    const existing = await prisma.errorSignatureDailyAggregate.findUnique({
      where: {
        signatureHash_day: {
          signatureHash: signatureDayDelta.signatureHash,
          day: signatureDayDelta.day,
        },
      },
    })

    if (!existing) {
      await prisma.errorSignatureDailyAggregate.create({
        data: {
          signatureHash: signatureDayDelta.signatureHash,
          day: signatureDayDelta.day,
          count: signatureDayDelta.count,
        },
      })
    } else {
      await prisma.errorSignatureDailyAggregate.update({
        where: {
          signatureHash_day: {
            signatureHash: signatureDayDelta.signatureHash,
            day: signatureDayDelta.day,
          },
        },
        data: {
          count: existing.count + signatureDayDelta.count,
        },
      })
    }
  }

  await prisma.errorIngestionCursor.upsert({
    where: { sourcePath },
    create: {
      sourcePath,
      deviceId: fingerprint.deviceId,
      inode: fingerprint.inode,
      offsetBytes: fingerprint.fileSizeBytes,
      fileMtimeMs: fingerprint.fileMtimeMs,
      fileSizeBytes: fingerprint.fileSizeBytes,
    },
    update: {
      deviceId: fingerprint.deviceId,
      inode: fingerprint.inode,
      offsetBytes: fingerprint.fileSizeBytes,
      fileMtimeMs: fingerprint.fileMtimeMs,
      fileSizeBytes: fingerprint.fileSizeBytes,
    },
  })

  return {
    processedEvents,
    signaturesUpdated,
    daysUpdated,
    cursorReset,
    durationMs: Date.now() - startedAt,
  }
}

function normalizeDays(days: number | undefined): number {
  return Number.isFinite(days) ? Math.max(1, Math.min(90, Math.floor(days as number))) : 14
}

function normalizeLimit(limit: number | undefined): number {
  return Number.isFinite(limit) ? Math.max(1, Math.min(100, Math.floor(limit as number))) : 20
}

export async function listErrorSignatures(params?: {
  days?: number
  limit?: number
  includeRaw?: boolean
}): Promise<ListErrorSignaturesResult> {
  const safeDays = normalizeDays(params?.days)
  const safeLimit = normalizeLimit(params?.limit)
  const includeRaw = params?.includeRaw === true
  const { from, to } = dateRangeFromDays(safeDays)

  const grouped = await prisma.errorSignatureDailyAggregate.groupBy({
    by: ['signatureHash'],
    where: {
      day: {
        gte: from,
        lte: to,
      },
    },
    _sum: { count: true },
    orderBy: {
      _sum: {
        count: 'desc',
      },
    },
    take: safeLimit,
  })

  const allDistinct = await prisma.errorSignatureDailyAggregate.findMany({
    where: {
      day: {
        gte: from,
        lte: to,
      },
    },
    distinct: ['signatureHash'],
    select: { signatureHash: true },
  })

  const hashes = grouped
    .map((row) => row.signatureHash)
    .filter((hash): hash is string => typeof hash === 'string' && hash.length > 0)

  const aggregateRows = hashes.length > 0
    ? await prisma.errorSignatureAggregate.findMany({
        where: {
          signatureHash: { in: hashes },
        },
      })
    : []

  const insightRows = hashes.length > 0
    ? await prisma.errorSignatureInsight.findMany({
        where: {
          signatureHash: { in: hashes },
        },
      })
    : []

  const aggregatesByHash = new Map(aggregateRows.map((row) => [row.signatureHash, row]))
  const insightsByHash = new Map(insightRows.map((row) => [row.signatureHash, row]))

  const signatures: ErrorSignatureListItem[] = grouped.map((row) => {
    const aggregate = aggregatesByHash.get(row.signatureHash)
    const signatureText = aggregate?.signatureText || row.signatureHash
    const sample = aggregate?.lastSampleSanitized || ''
    const rawSampleRedacted = aggregate?.lastSampleRawRedacted || ''
    const classification = classifyErrorSignature({
      signatureText,
      sample,
      sampleRawRedacted: rawSampleRedacted,
    })

    return {
      signatureHash: row.signatureHash,
      signatureText,
      count: (row._sum.count ?? 0n).toString(),
      windowCount: (row._sum.count ?? 0n).toString(),
      allTimeCount: (aggregate?.count ?? 0n).toString(),
      firstSeen: (aggregate?.firstSeenAt ?? new Date(0)).toISOString(),
      lastSeen: (aggregate?.lastSeenAt ?? new Date(0)).toISOString(),
      sample,
      ...(includeRaw ? { rawRedactedSample: rawSampleRedacted } : {}),
      classification,
      insight: toInsightSnapshot(insightsByHash.get(row.signatureHash) ?? null),
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    days: safeDays,
    signatures,
    meta: {
      limit: safeLimit,
      includeRaw,
      windowUniqueSignatures: allDistinct.length,
    },
  }
}

export async function getErrorSummary(days = 14): Promise<ErrorSummaryResult> {
  const safeDays = normalizeDays(days)
  const { from, to } = dateRangeFromDays(safeDays)

  const dailyRows = await prisma.errorDailyAggregate.findMany({
    where: {
      day: {
        gte: from,
        lte: to,
      },
    },
    orderBy: { day: 'asc' },
  })

  const trend = buildZeroFilledTrend(from, safeDays, dailyRows)
  const totalErrors = trend.reduce((sum, row) => sum + BigInt(row.count), 0n)
  const topSignatures = await listErrorSignatures({
    days: safeDays,
    limit: 15,
    includeRaw: false,
  })

  const spike = computeSpikeMetrics(trend)

  return {
    generatedAt: new Date().toISOString(),
    from: from.toISOString(),
    to: to.toISOString(),
    trend,
    totals: {
      totalErrors: totalErrors.toString(),
      uniqueSignatures: await prisma.errorSignatureAggregate.count(),
      windowUniqueSignatures: topSignatures.meta.windowUniqueSignatures,
    },
    topSignatures: topSignatures.signatures,
    spike,
  }
}
