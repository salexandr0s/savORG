import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRepos } from '@/lib/repo'
import { checkGatewayAvailability, getWsConsoleClient } from '@/lib/openclaw/console-client'
import { getRequestActor } from '@/lib/request-actor'

interface AbortRequestBody {
  runId?: string | null
}

/**
 * POST /api/openclaw/console/sessions/[id]/abort
 *
 * Abort a running chat generation for a session (server-side WS).
 *
 * Safety:
 * - Server-side only (gateway token never exposed)
 * - Fail-closed if gateway unavailable
 * - Records receipt + activity for audit trail
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params
  const { actor } = getRequestActor(request)

  let body: AbortRequestBody = {}
  try {
    body = (await request.json()) as AbortRequestBody
  } catch {
    // Body is optional
  }

  const runId = typeof body.runId === 'string' ? body.runId : undefined

  // Verify session exists
  const session = await prisma.agentSession.findUnique({
    where: { sessionId },
  })

  if (!session) {
    return NextResponse.json(
      { ok: false, error: 'Session not found', code: 'SESSION_NOT_FOUND' },
      { status: 404 }
    )
  }

  // Check gateway availability (fail-closed for writes)
  const availability = await checkGatewayAvailability()
  if (!availability.available) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Gateway unavailable — cannot abort',
        code: 'GATEWAY_UNAVAILABLE',
        details: { latencyMs: availability.latencyMs, gatewayError: availability.error },
      },
      { status: 503 }
    )
  }

  const repos = getRepos()
  const startTime = Date.now()

  const receipt = await repos.receipts.create({
    workOrderId: session.workOrderId ?? 'console',
    operationId: session.operationId,
    kind: 'manual',
    commandName: 'console.session.abort',
    commandArgs: {
      sessionId,
      sessionKey: session.sessionKey,
      agentId: session.agentId,
      runId: runId ?? null,
    },
  })

  await repos.activities.create({
    type: 'openclaw.session.abort',
    actor: actor || 'operator:unknown',
    entityType: 'session',
    entityId: session.sessionKey,
    summary: `Aborted session chat ${session.sessionKey}${runId ? ` (run ${runId})` : ''}`,
    payloadJson: {
      receiptId: receipt.id,
      sessionId,
      sessionKey: session.sessionKey,
      agentId: session.agentId,
      runId: runId ?? null,
    },
  })

  try {
    const client = getWsConsoleClient()
    const result = await client.chatAbort({
      sessionKey: session.sessionKey,
      runId,
    })

    const durationMs = Date.now() - startTime
    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs,
      parsedJson: {
        ok: result.ok,
        aborted: result.aborted,
        runIds: result.runIds,
      },
    })

    return NextResponse.json({
      ok: true,
      aborted: result.aborted,
      runIds: result.runIds,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Abort failed'
    const durationMs = Date.now() - startTime
    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs,
      parsedJson: {
        error: message,
        runId: runId ?? null,
      },
    })

    return NextResponse.json(
      { ok: false, error: message, code: 'ABORT_FAILED' },
      { status: 500 }
    )
  }
}

