import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import {
  getValidOperationTransitions,
  type OperationStatus,
} from '@clawcontrol/core'

interface RouteContext {
  params: Promise<{ id: string }>
}

const OPERATION_STATUSES = new Set<OperationStatus>([
  'todo',
  'in_progress',
  'blocked',
  'review',
  'done',
  'rework',
])

/**
 * GET /api/operations/:id
 *
 * Get a single operation
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  try {
    const repos = getRepos()
    const data = await repos.operations.getById(id)

    if (!data) {
      return NextResponse.json(
        { error: 'Operation not found' },
        { status: 404 }
      )
    }

    // Include allowed status transitions
    const allowedTransitions = getValidOperationTransitions(data.status as OperationStatus)

    return NextResponse.json({ data, allowedTransitions })
  } catch (error) {
    console.error('[api/operations/:id] GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch operation' },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/operations/:id
 *
 * Update an operation with status transition validation
 */
export async function PATCH(
  request: NextRequest,
  context: RouteContext
) {
  const { id } = await context.params

  try {
    const auth = verifyOperatorRequest(request, { requireCsrf: true })
    if (!auth.ok) {
      return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
    }

    const body = await request.json()
    const { status, notes, blockedReason } = body

    const repos = getRepos()
    const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status')
    const nextStatus = hasStatus ? String(status ?? '').trim() : undefined
    // Always fetch current for comparison
    const current = await repos.operations.getById(id)
    if (!current) {
      return NextResponse.json(
        { error: 'Operation not found' },
        { status: 404 }
      )
    }

    if (hasStatus && (!nextStatus || !OPERATION_STATUSES.has(nextStatus as OperationStatus))) {
      return NextResponse.json(
        { error: `Invalid status: ${status}`, code: 'INVALID_STATUS' },
        { status: 400 }
      )
    }

    if (hasStatus) {
      return NextResponse.json(
        {
          error: 'Operation status transitions are manager-controlled',
          code: 'MANAGER_CONTROLLED_OPERATION_STATUS',
        },
        { status: 403 }
      )
    }

    // No status change - regular update without activity
    const data = await repos.operations.update(id, {
      notes,
      blockedReason,
    })

    if (!data) {
      return NextResponse.json(
        { error: 'Failed to update operation' },
        { status: 500 }
      )
    }

    return NextResponse.json({ data })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('INVALID_OPERATION_STATUS')) {
      return NextResponse.json(
        { error: error.message, code: 'INVALID_STATUS' },
        { status: 400 }
      )
    }
    console.error('[api/operations/:id] PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update operation' },
      { status: 500 }
    )
  }
}
