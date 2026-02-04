import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import type { SkillScope } from '@clawcontrol/core'

/**
 * POST /api/skills/:scope/:id/validate
 * Validate a skill and return the result
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ scope: string; id: string }> }
) {
  const { scope, id } = await params

  if (!['global', 'agent'].includes(scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const repos = getRepos()

  try {
    const validationResult = await repos.skills.validate(scope as SkillScope, id)

    return NextResponse.json({
      data: {
        validation: validationResult,
      },
    })
  } catch (err) {
    // If skill not found, validate() will throw
    if (err instanceof Error && err.message.includes('not found')) {
      return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
    }
    throw err
  }
}
