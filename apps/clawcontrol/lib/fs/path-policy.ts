/**
 * Path Policy - Centralized Workspace Path Validation
 *
 * Enforces security policies for workspace file operations:
 * - Rejects path traversal (..)
 * - Rejects invalid characters (backslash, null byte)
 * - Restricts to allowed subdirectories
 * - Resolves symlinks to prevent escape attacks
 */

import { realpathSync, existsSync, lstatSync } from 'fs'
import { resolve, join } from 'path'

// Workspace root: where clawcontrol reads/writes agent files.
//
// Resolution order:
// - OPENCLAW_WORKSPACE (preferred)
// - CLAWCONTROL_WORKSPACE_ROOT (app-specific)
// - WORKSPACE_ROOT (legacy)
// - Auto-detect: ../../../../.. (when clawcontrol is checked out under ~/clawd/projects/clawcontrol/apps/clawcontrol)
// - ./workspace (fallback for demo/dev)
function isWorkspaceMarkerPath(dir: string): boolean {
  return (
    existsSync(join(dir, 'AGENTS.md'))
    || existsSync(join(dir, 'SOUL.md'))
    || existsSync(join(dir, 'HEARTBEAT.md'))
  )
}

function findNearestWorkspaceRoot(startDir: string, maxDepth = 10): string | null {
  let cursor = resolve(startDir)

  for (let depth = 0; depth <= maxDepth; depth++) {
    if (isWorkspaceMarkerPath(cursor)) return cursor

    const parent = resolve(cursor, '..')
    if (parent === cursor) break
    cursor = parent
  }

  return null
}

function pickWorkspaceRoot(): string {
  const envCandidates = [
    process.env.OPENCLAW_WORKSPACE,
    process.env.CLAWCONTROL_WORKSPACE_ROOT,
    process.env.WORKSPACE_ROOT,
  ]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map((value) => resolve(value))

  for (const candidate of envCandidates) {
    // Env var is explicit; if path exists, trust it even without markers.
    if (existsSync(candidate)) return candidate
  }

  const discovered = findNearestWorkspaceRoot(process.cwd())
  if (discovered) return discovered

  const localWorkspace = resolve(process.cwd(), 'workspace')
  if (existsSync(localWorkspace)) return localWorkspace

  // Final fallback: current working directory (never auto-fallback to /).
  return resolve(process.cwd())
}

const WORKSPACE_ROOT = pickWorkspaceRoot()
const WORKSPACE_ROOT_REAL = existsSync(WORKSPACE_ROOT) ? realpathSync(WORKSPACE_ROOT) : WORKSPACE_ROOT

// Allowed top-level subdirectories within workspace
const ALLOWED_SUBDIRS = ['agents', 'overlays', 'skills', 'playbooks', 'plugins', 'agent-templates', 'memory', 'life', 'docs', 'tools', 'templates', 'canvas', 'projects'] as const
type AllowedSubdir = (typeof ALLOWED_SUBDIRS)[number]

const ENFORCE_ROOT_ALLOWLIST = process.env.CLAWCONTROL_WORKSPACE_ALLOWLIST_ONLY === '1'

function isWithinRoot(candidatePath: string, rootPath: string): boolean {
  const root = resolve(rootPath)
  const candidate = resolve(candidatePath)
  return candidate === root || candidate.startsWith(`${root}/`)
}

// Allowed root-level files (e.g. /MEMORY.md). These do not live under a subdir.
const ALLOWED_ROOT_FILES = [
  'AGENTS.md',
  'MEMORY.md',
  'SOUL.md',
  'USER.md',
  'TOOLS.md',
  'HEARTBEAT.md',
  'README.md',
  'BOOTSTRAP.md',
  'COMMANDS.md',
  'IDENTITY.md',
  'SECURITY.md',
  'SECURITY.local.md',
  'WORKING.md',
] as const

export interface PathValidationResult {
  valid: boolean
  error?: string
  resolvedPath?: string
}

/**
 * Validate a workspace path for security.
 * Returns validation result with resolved path if valid.
 *
 * @param inputPath - Path relative to workspace root (must start with /)
 * @returns Validation result
 */
export function validateWorkspacePath(inputPath: string): PathValidationResult {
  // Must start with /
  if (!inputPath.startsWith('/')) {
    return { valid: false, error: 'Path must start with /' }
  }

  // No path traversal
  if (inputPath.includes('..')) {
    return { valid: false, error: 'Path traversal (..) not allowed' }
  }

  // No Windows-style paths
  if (inputPath.includes('\\')) {
    return { valid: false, error: 'Backslash not allowed in path' }
  }

  // No null bytes
  if (inputPath.includes('\0')) {
    return { valid: false, error: 'Null byte not allowed in path' }
  }

  // Normalize path (remove double slashes, etc.)
  const normalized = inputPath.split('/').filter(Boolean).join('/')

  // Optional strict allowlist mode for high-restriction deployments.
  if (ENFORCE_ROOT_ALLOWLIST && normalized !== '') {
    const parts = normalized.split('/')
    const top = parts[0]

    const isRootFile = parts.length === 1 && (ALLOWED_ROOT_FILES as readonly string[]).includes(top)
    if (!isRootFile) {
      if (!ALLOWED_SUBDIRS.includes(top as AllowedSubdir)) {
        return {
          valid: false,
          error: `Directory not allowed: ${top}. Allowed: ${ALLOWED_SUBDIRS.join(', ')}`,
        }
      }
    }
  }

  // Construct full path
  const fullPath = resolve(WORKSPACE_ROOT, normalized)

  // Verify full path is still under workspace root (defense in depth)
  if (!isWithinRoot(fullPath, WORKSPACE_ROOT)) {
    return { valid: false, error: 'Path escapes workspace root' }
  }

  // If path exists, resolve symlinks and verify
  if (existsSync(fullPath)) {
    try {
      const resolved = realpathSync(fullPath)
      if (!isWithinRoot(resolved, WORKSPACE_ROOT_REAL)) {
        return { valid: false, error: 'Path escapes workspace via symlink' }
      }
      return { valid: true, resolvedPath: resolved }
    } catch (err) {
      return { valid: false, error: `Failed to resolve path: ${err}` }
    }
  }

  // For new files, check parent directory
  // Skip this check for WORKSPACE_ROOT itself - its parent is naturally outside
  const parentPath = resolve(fullPath, '..')
  if (fullPath !== WORKSPACE_ROOT && existsSync(parentPath)) {
    try {
      const resolvedParent = realpathSync(parentPath)
      if (!isWithinRoot(resolvedParent, WORKSPACE_ROOT_REAL)) {
        return { valid: false, error: 'Parent path escapes workspace via symlink' }
      }
    } catch (err) {
      return { valid: false, error: `Failed to resolve parent path: ${err}` }
    }
  }

  return { valid: true, resolvedPath: fullPath }
}

/**
 * Check if a path is a symlink
 */
export function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Get the workspace root path
 */
export function getWorkspaceRoot(): string {
  return WORKSPACE_ROOT
}

/**
 * Get the list of allowed subdirectories
 */
export function getAllowedSubdirs(): readonly string[] {
  return ALLOWED_SUBDIRS
}

export function getAllowedRootFiles(): readonly string[] {
  return ALLOWED_ROOT_FILES
}

export function isWorkspaceAllowlistOnly(): boolean {
  return ENFORCE_ROOT_ALLOWLIST
}

/**
 * Simple validation (legacy compatibility with workspace.ts)
 * Use validateWorkspacePath for full validation with symlink checking
 */
export function isValidWorkspacePath(path: string): boolean {
  // Must start with /
  if (!path.startsWith('/')) return false

  // No .. traversal
  if (path.includes('..')) return false

  // No backslashes (windows-style)
  if (path.includes('\\')) return false

  // No null bytes
  if (path.includes('\0')) return false

  // Normalize and check it's still under workspace
  const normalized = path.split('/').filter(Boolean).join('/')

  // Must be in root, an allowed root-level file, or an allowed subdir
  if (normalized === '') return true // root

  if (!ENFORCE_ROOT_ALLOWLIST) return true

  const parts = normalized.split('/')
  const top = parts[0]

  if (parts.length === 1 && (ALLOWED_ROOT_FILES as readonly string[]).includes(top)) {
    return true
  }

  return ALLOWED_SUBDIRS.includes(top as AllowedSubdir)
}
