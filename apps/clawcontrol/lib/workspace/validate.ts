import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import { join, resolve } from 'node:path'

export type WorkspaceIssueLevel = 'error' | 'warning'

export interface WorkspaceIssue {
  level: WorkspaceIssueLevel
  code: string
  message: string
  path?: string
}

export interface WorkspaceValidationResult {
  ok: boolean
  path: string | null
  exists: boolean
  issues: WorkspaceIssue[]
}

function normalizeWorkspacePath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return resolve(trimmed)
}

function collectRecommendedIssues(basePath: string): WorkspaceIssue[] {
  const issues: WorkspaceIssue[] = []

  const recommendedPaths = [
    { path: join(basePath, 'memory'), code: 'WORKSPACE_MISSING_MEMORY_DIR', message: 'Recommended directory missing: memory/' },
    { path: join(basePath, 'agents'), code: 'WORKSPACE_MISSING_AGENTS_DIR', message: 'Recommended directory missing: agents/' },
  ]

  for (const entry of recommendedPaths) {
    if (!fs.existsSync(entry.path)) {
      issues.push({
        level: 'warning',
        code: entry.code,
        message: entry.message,
        path: entry.path,
      })
    }
  }

  const agentsDir = join(basePath, 'agents')
  if (fs.existsSync(agentsDir) && fs.statSync(agentsDir).isDirectory()) {
    let hasSoul = false
    try {
      const entries = fs.readdirSync(agentsDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const soulPath = join(agentsDir, entry.name, 'SOUL.md')
        if (fs.existsSync(soulPath)) {
          hasSoul = true
          break
        }
      }
    } catch {
      // Ignore agents folder scan errors and continue.
    }

    if (!hasSoul) {
      issues.push({
        level: 'warning',
        code: 'WORKSPACE_MISSING_AGENT_SOUL',
        message: 'No agent SOUL.md files found under agents/<id>/SOUL.md',
        path: agentsDir,
      })
    }
  }

  return issues
}

export function validateWorkspaceStructureSync(inputPath: string | null | undefined): WorkspaceValidationResult {
  const normalized = normalizeWorkspacePath(inputPath)

  if (!normalized) {
    return {
      ok: false,
      path: null,
      exists: false,
      issues: [
        {
          level: 'error',
          code: 'WORKSPACE_NOT_CONFIGURED',
          message: 'Workspace path is not configured.',
        },
      ],
    }
  }

  const issues: WorkspaceIssue[] = []

  if (!fs.existsSync(normalized)) {
    issues.push({
      level: 'error',
      code: 'WORKSPACE_NOT_FOUND',
      message: 'Workspace directory does not exist.',
      path: normalized,
    })

    return {
      ok: false,
      path: normalized,
      exists: false,
      issues,
    }
  }

  const stats = fs.statSync(normalized)
  if (!stats.isDirectory()) {
    issues.push({
      level: 'error',
      code: 'WORKSPACE_NOT_DIRECTORY',
      message: 'Workspace path is not a directory.',
      path: normalized,
    })

    return {
      ok: false,
      path: normalized,
      exists: true,
      issues,
    }
  }

  const agentsFile = join(normalized, 'AGENTS.md')
  if (!fs.existsSync(agentsFile)) {
    issues.push({
      level: 'error',
      code: 'WORKSPACE_MISSING_AGENTS_MD',
      message: 'Workspace must include AGENTS.md at its root.',
      path: agentsFile,
    })
  }

  issues.push(...collectRecommendedIssues(normalized))

  return {
    ok: issues.every((issue) => issue.level !== 'error'),
    path: normalized,
    exists: true,
    issues,
  }
}

export async function validateWorkspaceStructure(inputPath: string | null | undefined): Promise<WorkspaceValidationResult> {
  const normalized = normalizeWorkspacePath(inputPath)

  if (!normalized) {
    return validateWorkspaceStructureSync(inputPath)
  }

  try {
    const stats = await fsp.stat(normalized)

    if (!stats.isDirectory()) {
      return {
        ok: false,
        path: normalized,
        exists: true,
        issues: [
          {
            level: 'error',
            code: 'WORKSPACE_NOT_DIRECTORY',
            message: 'Workspace path is not a directory.',
            path: normalized,
          },
        ],
      }
    }

    const result = validateWorkspaceStructureSync(normalized)
    return result
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code

    if (code === 'ENOENT') {
      return {
        ok: false,
        path: normalized,
        exists: false,
        issues: [
          {
            level: 'error',
            code: 'WORKSPACE_NOT_FOUND',
            message: 'Workspace directory does not exist.',
            path: normalized,
          },
        ],
      }
    }

    return {
      ok: false,
      path: normalized,
      exists: false,
      issues: [
        {
          level: 'error',
          code: 'WORKSPACE_UNREADABLE',
          message: 'Workspace path could not be read.',
          path: normalized,
        },
      ],
    }
  }
}
