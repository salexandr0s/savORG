import 'server-only'

import { prisma } from '../db'

export interface ToolRequest {
  agentName: string
  tool: string
  args?: Record<string, unknown>
  operationId?: string
  workOrderId?: string
}

export interface PolicyResult {
  allowed: boolean
  reason?: string
  requiresApproval?: boolean
  approvalType?: string
}

function safeParseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

/**
 * Checks if an agent is allowed to use a specific tool based on DB capabilities.
 */
export async function checkToolPolicy(request: ToolRequest): Promise<PolicyResult> {
  const agent = await prisma.agent.findUnique({
    where: { name: request.agentName },
  })

  if (!agent) {
    return { allowed: false, reason: `Unknown agent: ${request.agentName}` }
  }

  const capabilities = safeParseJsonObject(agent.capabilities)
  if (!capabilities) {
    return { allowed: false, reason: `Invalid capabilities JSON for agent: ${request.agentName}` }
  }

  const toolRequirements: Record<string, string[]> = {
    exec: ['can_execute_code'],
    write: ['can_modify_files'],
    edit: ['can_modify_files'],
    message: ['can_send_messages'],
    sessions_spawn: ['can_delegate'],
    sessions_send: ['can_delegate'],
    web_search: ['can_web_search'],
    web_fetch: ['can_web_search'],
    browser: ['can_execute_code'],
  }

  const requiredCaps = toolRequirements[request.tool] ?? []

  for (const cap of requiredCaps) {
    if (!capabilities[cap]) {
      return {
        allowed: false,
        reason: `Agent ${request.agentName} lacks capability: ${cap}`,
      }
    }
  }

  // Special case: BuildReview exec allowlist
  if (request.tool === 'exec' && request.agentName === 'savorgbuildreview') {
    const allowlist = Array.isArray(capabilities.exec_allowlist)
      ? (capabilities.exec_allowlist as unknown[])
          .filter((x): x is string => typeof x === 'string')
      : []

    const command = String(request.args?.command ?? request.args?.cmd ?? '')

    const isAllowed = allowlist.some((pattern) => command.startsWith(pattern))

    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Command not in BuildReview allowlist: ${command}`,
      }
    }
  }

  return { allowed: true }
}

/**
 * Route helper that enforces tool policies based on JSON body fields:
 * - agentName
 * - tool
 * - args (optional)
 *
 * Notes:
 * - Uses request.clone().json() so the downstream handler can still read req.json().
 * - Logs denials to Activity for auditability.
 */
export function withToolPolicy<
  TRequest extends Request,
  TContext = unknown,
  TResult extends Response | Promise<Response> = Promise<Response>
>(handler: (req: TRequest, ctx: TContext) => TResult) {
  return async (req: TRequest, ctx: TContext): Promise<Response> => {
    let body: unknown = null

    try {
      body = await req.clone().json()
    } catch {
      // Ignore non-JSON
    }

    const maybe = body as Partial<ToolRequest> | null

    if (maybe?.agentName && maybe?.tool) {
      const result = await checkToolPolicy({
        agentName: String(maybe.agentName),
        tool: String(maybe.tool),
        args: (maybe as { args?: unknown }).args as Record<string, unknown> | undefined,
        operationId: maybe.operationId ? String(maybe.operationId) : undefined,
        workOrderId: maybe.workOrderId ? String(maybe.workOrderId) : undefined,
      })

      if (!result.allowed) {
        const entityType = maybe.operationId ? 'operation' : 'agent'
        const entityId = maybe.operationId ? String(maybe.operationId) : String(maybe.agentName)

        await prisma.activity.create({
          data: {
            type: 'policy.tool_denied',
            actor: `agent:${maybe.agentName}`,
            entityType,
            entityId,
            summary: `Tool policy denied: ${maybe.tool}`,
            payloadJson: JSON.stringify({
              agentName: maybe.agentName,
              tool: maybe.tool,
              args: (maybe as { args?: unknown }).args ?? null,
              reason: result.reason ?? null,
            }),
          },
        }).catch(() => {})

        return new Response(
          JSON.stringify({ error: 'POLICY_DENIED', reason: result.reason }),
          { status: 403, headers: { 'content-type': 'application/json' } }
        )
      }
    }

    return handler(req, ctx) as unknown as Response
  }
}

