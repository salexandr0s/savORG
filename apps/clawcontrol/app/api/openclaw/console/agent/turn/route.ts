import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getRepos } from '@/lib/repo'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getConsoleClient, checkGatewayAvailability } from '@/lib/openclaw/console-client'
import { getRequestActor } from '@/lib/request-actor'

// ============================================================================
// TYPES
// ============================================================================

interface AgentTurnRequestBody {
  agentId: string
  message: string
  sessionKey?: string
  model?: string
  thinking?: string
  timeoutSeconds?: number
  typedConfirmText?: string
}

// ============================================================================
// POST /api/openclaw/console/agent/turn
// ============================================================================

/**
 * Spawn an agent turn with a task.
 *
 * Governor-gated: Requires typed confirmation ("CONFIRM").
 * Creates Activity + Receipt for audit trail.
 * Returns SSE stream with response chunks.
 *
 * Request body:
 * - agentId: Target agent ID (required)
 * - message: Task message (required, 1-10000 chars)
 * - sessionKey: Optional session key for context
 * - model: Optional model override
 * - thinking: Optional thinking mode
 * - timeoutSeconds: Optional timeout
 * - typedConfirmText: Confirmation text (required, must be "CONFIRM")
 */
export async function POST(request: NextRequest) {
  const { actor } = getRequestActor(request)

  // Parse and validate request body
  let body: AgentTurnRequestBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body', code: 'INVALID_BODY' },
      { status: 400 }
    )
  }

  const { agentId, message, sessionKey, typedConfirmText } = body

  // Validate agentId
  if (!agentId || typeof agentId !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'Agent ID is required', code: 'MISSING_AGENT_ID' },
      { status: 400 }
    )
  }

  // Validate agentId format (alphanumeric + dash/underscore)
  if (!/^[a-zA-Z0-9_-]+$/.test(agentId)) {
    return NextResponse.json(
      { ok: false, error: 'Invalid agent ID format', code: 'INVALID_AGENT_ID' },
      { status: 400 }
    )
  }

  // Validate message
  if (!message || typeof message !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'Message is required', code: 'MISSING_MESSAGE' },
      { status: 400 }
    )
  }

  if (message.length === 0 || message.length > 10000) {
    return NextResponse.json(
      { ok: false, error: 'Message must be 1-10000 characters', code: 'INVALID_MESSAGE_LENGTH' },
      { status: 400 }
    )
  }

  // Verify agent exists in our database
  const agent = await prisma.agent.findFirst({
    where: { name: agentId },
  })

  if (!agent) {
    return NextResponse.json(
      { ok: false, error: `Agent not found: ${agentId}`, code: 'AGENT_NOT_FOUND' },
      { status: 404 }
    )
  }

  // Check gateway availability (fail-closed for writes)
  const availability = await checkGatewayAvailability()
  if (!availability.available) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Gateway unavailable — cannot spawn turn',
        code: 'GATEWAY_UNAVAILABLE',
        details: { latencyMs: availability.latencyMs, gatewayError: availability.error },
      },
      { status: 503 }
    )
  }

  // Enforce typed confirmation (governor-gated)
  const enforcement = await enforceTypedConfirm({
    actionKind: 'console.agent.turn',
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
    workOrderId: 'console',
    kind: 'manual',
    commandName: 'console.agent.turn',
    commandArgs: {
      agentId,
      sessionKey,
      messagePreview: message.slice(0, 100),
    },
  })

  // Create activity for audit trail
  await repos.activities.create({
    type: 'openclaw.agent.turn',
    actor: actor || 'operator:unknown',
    entityType: 'agent',
    entityId: agentId,
    summary: `Spawned turn for ${agentId}`,
    payloadJson: {
      receiptId: receipt.id,
      sessionKey,
      messageLength: message.length,
    },
  })

  // Stream response from gateway
  const client = getConsoleClient()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      let fullResponse = ''

      try {
        for await (const chunk of client.sendToAgent(agentId, message)) {
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
          type: 'openclaw.agent.turn.complete',
          actor: `agent:${agentId}`,
          entityType: 'agent',
          entityId: agentId,
          summary: `Turn completed for ${agentId} (${fullResponse.length} chars)`,
          payloadJson: {
            receiptId: receipt.id,
            responseLength: fullResponse.length,
            durationMs,
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
