import { NextRequest, NextResponse } from 'next/server'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { withIngestionLease } from '@/lib/openclaw/ingestion-lease'
import { listErrorSignatures, syncErrorLog } from '@/lib/openclaw/error-sync'
import { autoGenerateErrorInsights } from '@/lib/openclaw/error-insights'

const LEASE_NAME = 'errors-ingest'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const daysRaw = searchParams.get('days')
  const limitRaw = searchParams.get('limit')
  const includeRaw = searchParams.get('includeRaw') === 'true'

  if (includeRaw) {
    const auth = verifyOperatorRequest(request)
    if (!auth.ok) {
      return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
    }
  }

  const days = daysRaw ? Number(daysRaw) : 14
  const limit = limitRaw ? Number(limitRaw) : 20

  let ingestion:
    | {
      lockAcquired: boolean
      stats?: Awaited<ReturnType<typeof syncErrorLog>>
    }
    = { lockAcquired: false }

  const leased = await withIngestionLease(LEASE_NAME, async () => {
    const stats = await syncErrorLog()
    return stats
  })

  if (leased.lockAcquired) {
    ingestion = { lockAcquired: true, stats: leased.value }
  }

  const list = await listErrorSignatures({
    days,
    limit,
    includeRaw,
  })

  const insightSnapshots = await autoGenerateErrorInsights(list.signatures, { maxBatch: 3 })

  const signatures = list.signatures.map((signature) => ({
    ...signature,
    insight: insightSnapshots.get(signature.signatureHash) ?? signature.insight,
  }))

  return NextResponse.json({
    data: {
      ...list,
      signatures,
    },
    ingestion,
  })
}
