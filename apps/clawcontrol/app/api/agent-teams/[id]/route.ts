import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * GET /api/agent-teams/:id
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const repos = getRepos()
  const team = await repos.agentTeams.getById(id)
  if (!team) {
    return NextResponse.json({ error: 'Team not found', code: 'TEAM_NOT_FOUND' }, { status: 404 })
  }

  return NextResponse.json({ data: team })
}

/**
 * PATCH /api/agent-teams/:id
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = (await request.json().catch(() => null)) as {
    name?: string
    description?: string | null
    workflowIds?: string[]
    templateIds?: string[]
    healthStatus?: 'healthy' | 'warning' | 'degraded' | 'unknown'
    memberAgentIds?: string[]
    typedConfirmText?: string
  } | null

  if (!body) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'team.edit',
    typedConfirmText: body.typedConfirmText,
  })

  if (!enforcement.allowed) {
    return NextResponse.json(
      {
        error: enforcement.errorType,
        policy: enforcement.policy,
      },
      { status: enforcement.status ?? 403 }
    )
  }

  const repos = getRepos()
  const team = await repos.agentTeams.update(id, {
    name: body.name,
    description: body.description,
    workflowIds: body.workflowIds,
    templateIds: body.templateIds,
    healthStatus: body.healthStatus,
    memberAgentIds: body.memberAgentIds,
  })

  if (!team) {
    return NextResponse.json({ error: 'Team not found', code: 'TEAM_NOT_FOUND' }, { status: 404 })
  }

  return NextResponse.json({ data: team })
}

/**
 * DELETE /api/agent-teams/:id
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  const { id } = await context.params
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  const body = (await request.json().catch(() => ({}))) as {
    typedConfirmText?: string
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'team.delete',
    typedConfirmText: body.typedConfirmText,
  })

  if (!enforcement.allowed) {
    return NextResponse.json(
      {
        error: enforcement.errorType,
        policy: enforcement.policy,
      },
      { status: enforcement.status ?? 403 }
    )
  }

  const repos = getRepos()
  const deleted = await repos.agentTeams.delete(id)
  if (!deleted) {
    return NextResponse.json({ error: 'Team not found', code: 'TEAM_NOT_FOUND' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
