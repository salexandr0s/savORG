import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/db'
import { getRepos } from '@/lib/repo'
import { enforceTypedConfirm } from '@/lib/with-governor'
import {
  getWsConsoleClient,
  checkGatewayAvailability,
  type ChatEvent,
} from '@/lib/openclaw/console-client'
import { getRequestActor } from '@/lib/request-actor'

// ============================================================================
// TYPES
// ============================================================================

interface ChatRequestBody {
  text: string
  typedConfirmText?: string
}

// ============================================================================
// POST /api/openclaw/console/sessions/[id]/chat
// ============================================================================

/**
 * Send a message to an OpenClaw SESSION (true session messaging).
 *
 * IMPORTANT: This uses the gateway's WebSocket chat.send method, which
 * routes by sessionKey and injects into the existing session's context.
 * This is TRUE session injection, not just agent messaging.
 *
 * Governor-gated: Requires typed confirmation ("CONFIRM").
 * Creates Activity + Receipt for audit trail.
 * Returns SSE stream with response chunks from the agent.
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
  let body: ChatRequestBody
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
    actionKind: 'console.session.chat',
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
  const idempotencyKey = randomUUID()

  // Create receipt for tracking
  const receipt = await repos.receipts.create({
    workOrderId: session.workOrderId ?? 'console',
    operationId: session.operationId,
    kind: 'manual',
    commandName: 'console.session.chat',
    commandArgs: {
      sessionId,
      sessionKey: session.sessionKey,
      agentId: session.agentId,
      messagePreview: text.slice(0, 100),
      mode: 'session_chat', // TRUE session injection
      idempotencyKey,
    },
  })

  // Create activity for audit trail
  await repos.activities.create({
    type: 'openclaw.session.chat',
    actor: actor || 'operator:unknown',
    entityType: 'session', // Target is session
    entityId: session.sessionKey,
    summary: `Messaged session ${session.sessionKey} (${session.agentId})`,
    payloadJson: {
      receiptId: receipt.id,
      agentId: session.agentId,
      sessionId,
      sessionKey: session.sessionKey,
      messageLength: text.length,
      mode: 'session_chat',
      idempotencyKey,
    },
  })

  // Get WebSocket client
  const client = getWsConsoleClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let fullResponse = ''
      let runId: string | null = null

      // Emit metadata event first
      const metaEvent = JSON.stringify({
        mode: 'session_chat',
        targetSessionKey: session.sessionKey,
        targetAgentId: session.agentId,
        note: 'Routes by sessionKey via WS chat.send. TRUE session injection.',
      })
      controller.enqueue(encoder.encode(`data: ${metaEvent}\n\n`))

      try {
        // Send message via WebSocket
        const sendResult = await client.chatSend({
          sessionKey: session.sessionKey,
          message: text,
          idempotencyKey,
        })

        runId = sendResult.runId

        // Emit run started event
        const startEvent = JSON.stringify({
          runId,
          status: sendResult.status,
        })
        controller.enqueue(encoder.encode(`data: ${startEvent}\n\n`))

        // Subscribe to chat events for this run
        const eventPromise = new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => {
            unsubscribe()
            reject(new Error('Response timeout'))
          }, 120000) // 2 minute timeout

          const unsubscribe = client.streamChatEvents(runId!, (event: ChatEvent) => {
            // Handle delta events (streaming chunks)
            if (event.state === 'delta' && event.message) {
              const content = extractTextContent(event.message)
              if (content) {
                fullResponse += content
                const chunkEvent = JSON.stringify({ chunk: content })
                controller.enqueue(encoder.encode(`data: ${chunkEvent}\n\n`))

                // Append to receipt
                repos.receipts.append(receipt.id, {
                  stream: 'stdout',
                  chunk: content,
                }).catch(() => {})
              }
            }

            // Handle final event
            if (event.state === 'final') {
              clearTimeout(timeout)
              unsubscribe()

              // Extract final message if present
              if (event.message) {
                const content = extractTextContent(event.message)
                if (content && !fullResponse.includes(content)) {
                  fullResponse = content
                }
              }

              resolve()
            }

            // Handle error event
            if (event.state === 'error') {
              clearTimeout(timeout)
              unsubscribe()
              reject(new Error(event.errorMessage ?? 'Chat error'))
            }

            // Handle aborted event
            if (event.state === 'aborted') {
              clearTimeout(timeout)
              unsubscribe()
              resolve()
            }
          })
        })

        await eventPromise

        // Finalize receipt with success
        const durationMs = Date.now() - startTime
        await repos.receipts.finalize(receipt.id, {
          exitCode: 0,
          durationMs,
          parsedJson: {
            runId,
            response: fullResponse,
            responseLength: fullResponse.length,
          },
        })

        // Create completion activity
        await repos.activities.create({
          type: 'openclaw.session.chat.response',
          actor: `agent:${session.agentId}`,
          entityType: 'session',
          entityId: session.sessionKey,
          summary: `Response from ${session.agentId} (${fullResponse.length} chars)`,
          payloadJson: {
            receiptId: receipt.id,
            runId,
            sessionKey: session.sessionKey,
            responseLength: fullResponse.length,
            durationMs,
            mode: 'session_chat',
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
            runId,
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

// ============================================================================
// Helpers
// ============================================================================

function extractTextContent(message: unknown): string | null {
  if (!message || typeof message !== 'object') {
    return null
  }

  const msg = message as Record<string, unknown>

  // Handle content array format
  if (Array.isArray(msg.content)) {
    for (const item of msg.content) {
      if (item && typeof item === 'object' && 'type' in item && item.type === 'text' && 'text' in item) {
        return String(item.text)
      }
    }
  }

  // Handle string content
  if (typeof msg.content === 'string') {
    return msg.content
  }

  return null
}
