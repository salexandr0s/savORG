import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import type { ActionKind } from '@clawcontrol/core'
import type { SkillScope } from '@/lib/repo'

/**
 * GET /api/skills
 * List all skills (global + agent-scoped)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const scope = searchParams.get('scope') as SkillScope | null
  const agentId = searchParams.get('agentId')

  const repos = getRepos()
  const skills = await repos.skills.list({
    scope: scope ?? undefined,
    agentId: agentId ?? undefined,
  })

  return NextResponse.json({ data: skills })
}

/**
 * POST /api/skills
 * Install a new skill (with Governor gating)
 */
export async function POST(request: NextRequest) {
  const body = await request.json()
  const { name, description, scope, agentId, skillMd, typedConfirmText } = body

  // Validate required fields
  if (!name || typeof name !== 'string') {
    return NextResponse.json({ error: 'Skill name is required' }, { status: 400 })
  }

  if (!scope || !['global', 'agent'].includes(scope)) {
    return NextResponse.json({ error: 'Valid scope (global/agent) is required' }, { status: 400 })
  }

  if (scope === 'agent' && !agentId) {
    return NextResponse.json({ error: 'Agent ID is required for agent-scoped skills' }, { status: 400 })
  }

  // Validate skill name (path safety)
  const safeNameRegex = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/
  if (name.length < 2 || (!safeNameRegex.test(name) && !/^[a-z0-9]$/.test(name)) || name.includes('..')) {
    return NextResponse.json(
      { error: 'Invalid skill name. Use lowercase letters, numbers, and hyphens only.' },
      { status: 400 }
    )
  }

  const repos = getRepos()

  // Check for existing skill with same name
  const existing = await repos.skills.getByName(scope, name, agentId)
  if (existing) {
    return NextResponse.json({ error: 'Skill with this name already exists' }, { status: 409 })
  }

  // Enforce Governor - skill.install is danger level
  const ACTION_KIND: ActionKind = 'skill.install'
  const result = await enforceTypedConfirm({
    actionKind: ACTION_KIND,
    typedConfirmText,
  })

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.errorType,
        policy: result.policy,
      },
      { status: result.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
    )
  }

  try {
    // Create new skill via repo
    const newSkill = await repos.skills.create({
      name,
      description: description || '',
      scope: scope as SkillScope,
      agentId: scope === 'agent' ? agentId : undefined,
      skillMd: skillMd || `# ${name}\n\nSkill description goes here.`,
    })

    // Log activity
    await repos.activities.create({
      type: 'skill.installed',
      actor: 'user',
      entityType: 'skill',
      entityId: newSkill.id,
      summary: `Installed skill: ${name}`,
      payloadJson: {
        scope,
        agentId: scope === 'agent' ? agentId : null,
        version: newSkill.version,
      },
    })

    return NextResponse.json({ data: newSkill }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create skill'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
