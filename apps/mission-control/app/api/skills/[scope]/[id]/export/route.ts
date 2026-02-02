import { NextRequest, NextResponse } from 'next/server'
import { getRepos } from '@/lib/repo'
import type { SkillScope } from '@savorg/core'

/**
 * GET /api/skills/:scope/:id/export
 * Export a skill as a zip file with manifest
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ scope: string; id: string }> }
) {
  const { scope, id } = await params

  if (!['global', 'agent'].includes(scope)) {
    return NextResponse.json({ error: 'Invalid scope' }, { status: 400 })
  }

  const repos = getRepos()

  // Get skill to verify it exists and get metadata for filename
  const skill = await repos.skills.getById(scope as SkillScope, id)
  if (!skill) {
    return NextResponse.json({ error: 'Skill not found' }, { status: 404 })
  }

  try {
    // Generate zip using repo
    const zipBlob = await repos.skills.exportZip(scope as SkillScope, id)

    // Return zip file
    return new NextResponse(zipBlob, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${skill.name}-${skill.version}.zip"`,
      },
    })
  } catch (err) {
    console.error('[skills/export] Failed to export skill:', err)
    return NextResponse.json({ error: 'Failed to export skill' }, { status: 500 })
  }
}
