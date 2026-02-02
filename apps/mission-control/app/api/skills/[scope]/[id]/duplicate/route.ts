import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import type { ActionKind, SkillScope } from '@savorg/core'

/**
 * POST /api/skills/:scope/:id/duplicate
 * Duplicate/copy a skill to another scope
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ scope: string; id: string }> }
) {
  const { scope, id } = await params

  if (!['global', 'agent'].includes(scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const repos = getRepos()

  // Get source skill
  const sourceSkill = await repos.skills.getById(scope as SkillScope, id)
  if (!sourceSkill) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  const body = await request.json()
  const { targetScope, targetAgentId, newName, typedConfirmText } = body

  // Validate target scope
  if (!targetScope || !['global', 'agent'].includes(targetScope)) {
    return NextResponse.json({ error: 'Valid target scope is required' }, { status: 400 })
  }

  // Validate agent ID for agent scope
  if (targetScope === 'agent' && !targetAgentId) {
    return NextResponse.json({ error: 'Agent ID is required for agent scope' }, { status: 400 })
  }

  // Validate agent exists
  if (targetScope === 'agent') {
    const agent = await repos.agents.getById(targetAgentId)
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
    }
  }

  // Determine skill name
  const skillName = newName || `${sourceSkill.name}-copy`

  // Check if name is valid
  const safeNameRegex = /^[a-z0-9][a-z0-9-_]{1,48}$/
  if (!safeNameRegex.test(skillName)) {
    return NextResponse.json(
      { error: 'Invalid skill name. Use lowercase letters, numbers, hyphens and underscores.' },
      { status: 400 }
    )
  }

  // Check for existing skill with same name in target scope
  const existingSkill = await repos.skills.getByName(targetScope as SkillScope, skillName, targetAgentId)
  if (existingSkill) {
    return NextResponse.json({ error: 'Skill with this name already exists in target scope' }, { status: 409 })
  }

  // Determine action kind based on direction
  let actionKind: ActionKind
  if (targetScope === 'global') {
    actionKind = 'skill.duplicate_to_global' // danger level
  } else {
    actionKind = 'skill.duplicate_to_agent' // caution level
  }

  // Enforce Governor
  const result = await enforceTypedConfirm({
    actionKind,
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

  // Duplicate the skill using repo
  const newSkill = await repos.skills.duplicate(scope as SkillScope, id, {
    scope: targetScope as SkillScope,
    agentId: targetScope === 'agent' ? targetAgentId : undefined,
    newName: skillName,
  })

  // Log activity
  await repos.activities.create({
    type: 'skill.duplicated',
    actor: 'user',
    entityType: 'skill',
    entityId: newSkill.id,
    summary: `Duplicated skill: ${sourceSkill.name} → ${skillName}`,
    payloadJson: {
      sourceScope: scope,
      sourceId: id,
      targetScope,
      targetAgentId: targetScope === 'agent' ? targetAgentId : null,
      validationStatus: newSkill.validation?.status ?? 'unknown',
    },
  })

  // Get agent name for response
  let agentName: string | undefined
  if (targetScope === 'agent' && targetAgentId) {
    const agent = await repos.agents.getById(targetAgentId)
    agentName = agent?.name
  }

  return NextResponse.json({
    data: {
      ...newSkill,
      agentName,
    },
  }, { status: 201 })
}
