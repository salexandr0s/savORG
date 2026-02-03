import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRepos } from '@/lib/repo'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getConsoleClient, checkGatewayAvailability } from '@/lib/openclaw/console-client'
import { getRequestActor } from '@/lib/request-actor'

// ============================================================================
// TYPES
// ============================================================================

interface SendRequestBody {
  text: string
  typedConfirmText?: string
}

// ============================================================================
// POST /api/openclaw/console/sessions/[id]/send
// ============================================================================

/**
 * Send a message to an OpenClaw AGENT (not session injection).
 *
 * IMPORTANT: This routes by agentId via the gateway's /v1/chat/completions
 * endpoint. It does NOT inject into an existing session's context window.
 * The session is used only to identify which agent to message and for
 * audit trail linking.
 *
 * For true session injection, OpenClaw would need to expose a
 * `POST /v1/sessions/{id}/inject` endpoint (not currently available).
 *
 * Governor-gated: Requires typed confirmation ("CONFIRM").
 * Creates Activity + Receipt for audit trail.
 * Returns SSE stream with response chunks.
 *
 * Request body:
 * - text: Message to send (required, 1-10000 chars)
 * - typedConfirmText: Confirmation text (required, must be "CONFIRM")
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params
  const { actor } = getRequestActor(request)

  // Parse and validate request body
  let body: SendRequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400 }
    )
  }

  const { text, typedConfirmText } = body

  // Validate text
  if (!text || typeof text !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'Message text is required', code: 'MISSING_TEXT' },
      { status: 400 }
    )
  }

  if (text.length === 0 || text.length > 10000) {
    return NextResponse.json(
      { ok: false, error: 'Message must be 1-10000 characters', code: 'INVALID_TEXT_LENGTH' },
      { status: 400 }
    )
  }

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
        error: 'Gateway unavailable — cannot send',
        code: 'GATEWAY_UNAVAILABLE',
        details: { latencyMs: availability.latencyMs, gatewayError: availability.error },
      },
      { status: 503 }
    )
  }

  // Enforce typed confirmation (governor-gated)
  const enforcement = await enforceTypedConfirm({
    actionKind: 'console.agent.chat',
    typedConfirmText,
  })

  if (!enforcement.allowed) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Typed confirmation required',
        code: enforcement.errorType,
        confirmMode: enforcement.policy.confirmMode,
      },
      { status: enforcement.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
    )
  }

  const repos = getRepos()
  const startTime = Date.now()

  // Create receipt for tracking
  const receipt = await repos.receipts.create({
    workOrderId: session.workOrderId ?? 'console',
    operationId: session.operationId,
    kind: 'manual',
    commandName: 'console.agent.chat',
    commandArgs: {
      sessionId,
      agentId: session.agentId,
      messagePreview: text.slice(0, 100),
      mode: 'agent_chat', // NOT session injection
    },
  })

  // Create activity for audit trail
  await repos.activities.create({
    type: 'openclaw.agent.chat',
    actor: actor || 'operator:unknown',
    entityType: 'agent', // Target is agent, not session
    entityId: session.agentId,
    summary: `Messaged agent ${session.agentId} (not session injection)`,
    payloadJson: {
      receiptId: receipt.id,
      agentId: session.agentId,
      sessionId, // For reference only
      sessionKey: session.sessionKey,
      messageLength: text.length,
      mode: 'agent_chat',
    },
  })

  // Stream response from gateway
  const client = getConsoleClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let fullResponse = ''

      // Emit metadata event first so clients know this is agent chat, not session injection
      const metaEvent = JSON.stringify({
        mode: 'agent_chat',
        targetAgentId: session.agentId,
        targetSessionId: sessionId,
        note: 'Routes by agentId. Does NOT inject into existing session context.',
      })
      controller.enqueue(encoder.encode(`data: ${metaEvent}\n\n`))

      try {
        for await (const chunk of client.sendToAgent(session.agentId, text)) {
          fullResponse += chunk

          // Send SSE event
          const event = JSON.stringify({ chunk })
          controller.enqueue(encoder.encode(`data: ${event}\n\n`))

          // Append to receipt (streaming updates)
          await repos.receipts.append(receipt.id, {
            stream: 'stdout',
            chunk,
          })
        }

        // Finalize receipt with success
        const durationMs = Date.now() - startTime
        await repos.receipts.finalize(receipt.id, {
          exitCode: 0,
          durationMs,
          parsedJson: {
            response: fullResponse,
            responseLength: fullResponse.length,
          },
        })

        // Create completion activity
        await repos.activities.create({
          type: 'openclaw.agent.chat.response',
          actor: `agent:${session.agentId}`,
          entityType: 'agent',
          entityId: session.agentId,
          summary: `Response from ${session.agentId} (${fullResponse.length} chars)`,
          payloadJson: {
            receiptId: receipt.id,
            sessionId, // For reference
            responseLength: fullResponse.length,
            durationMs,
            mode: 'agent_chat',
          },
        })

        // Send done event
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error'

        // Finalize receipt with error
        const durationMs = Date.now() - startTime
        await repos.receipts.finalize(receipt.id, {
          exitCode: 1,
          durationMs,
          parsedJson: {
            error: errorMessage,
            partialResponse: fullResponse,
          },
        })

        // Send error event
        const errorEvent = JSON.stringify({ error: errorMessage })
        controller.enqueue(encoder.encode(`data: ${errorEvent}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Receipt-Id': receipt.id,
    },
  })
}
