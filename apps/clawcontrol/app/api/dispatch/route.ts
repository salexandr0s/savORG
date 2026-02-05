import { NextRequest, NextResponse } from 'next/server'
import { runManagerDispatchLoop } from '@/lib/services/dispatcher'

interface DispatchRequestBody {
  limit?: number
  dryRun?: boolean
}

/**
 * POST /api/dispatch
 *
 * Runs the manager dispatch loop for planned work orders.
 */
export async function POST(request: NextRequest) {
  let body: DispatchRequestBody = {}

  try {
    body = (await request.json()) as DispatchRequestBody
  } catch {
    // Empty body is allowed.
  }

  const requestedLimit = body.limit
  if (requestedLimit !== undefined && (!Number.isFinite(requestedLimit) || requestedLimit <= 0)) {
    return NextResponse.json(
      { error: 'Invalid limit. Expected a positive number.' },
      { status: 400 }
    )
  }

  const result = await runManagerDispatchLoop({
    limit: requestedLimit,
    dryRun: Boolean(body.dryRun),
  })

  return NextResponse.json({ data: result })
}
