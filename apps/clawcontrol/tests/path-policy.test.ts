import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

describe('workspace path policy', () => {
  const originalCwd = process.cwd()
  const originalWorkspace = process.env.OPENCLAW_WORKSPACE
  const originalClawcontrolWorkspaceRoot = process.env.CLAWCONTROL_WORKSPACE_ROOT
  const originalWorkspaceRoot = process.env.WORKSPACE_ROOT
  const originalAllowlistOnly = process.env.CLAWCONTROL_WORKSPACE_ALLOWLIST_ONLY

  let tempRoot = ''

  function restoreEnv(key: string, value: string | undefined): void {
    if (value === undefined) {
      delete process.env[key]
      return
    }
    process.env[key] = value
  }

  beforeEach(async () => {
    tempRoot = join(tmpdir(), `path-policy-test-${randomUUID()}`)
    await fsp.mkdir(tempRoot, { recursive: true })
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    restoreEnv('OPENCLAW_WORKSPACE', originalWorkspace)
    restoreEnv('CLAWCONTROL_WORKSPACE_ROOT', originalClawcontrolWorkspaceRoot)
    restoreEnv('WORKSPACE_ROOT', originalWorkspaceRoot)
    restoreEnv('CLAWCONTROL_WORKSPACE_ALLOWLIST_ONLY', originalAllowlistOnly)
    vi.resetModules()

    if (tempRoot) {
      await fsp.rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('finds nearest workspace root from cwd (does not fallback to /)', async () => {
    const repoLikeRoot = join(tempRoot, 'repo')
    const nested = join(repoLikeRoot, 'apps', 'clawcontrol')

    await fsp.mkdir(nested, { recursive: true })
    await fsp.writeFile(join(repoLikeRoot, 'AGENTS.md'), '# test')

    delete process.env.OPENCLAW_WORKSPACE
    delete process.env.CLAWCONTROL_WORKSPACE_ROOT
    delete process.env.WORKSPACE_ROOT
    process.chdir(nested)
    vi.resetModules()

    const mod = await import('@/lib/fs/path-policy')
    expect(await fsp.realpath(mod.getWorkspaceRoot())).toBe(await fsp.realpath(repoLikeRoot))
  })

  it('allows non-allowlisted top-level directories in default mode', async () => {
    await fsp.mkdir(join(tempRoot, 'my-custom-dir'), { recursive: true })
    await fsp.writeFile(join(tempRoot, 'AGENTS.md'), '# test')

    process.env.OPENCLAW_WORKSPACE = tempRoot
    delete process.env.CLAWCONTROL_WORKSPACE_ALLOWLIST_ONLY
    vi.resetModules()

    const { validateWorkspacePath } = await import('@/lib/fs/path-policy')
    const { listWorkspace } = await import('@/lib/fs/workspace-fs')

    const check = validateWorkspacePath('/my-custom-dir')
    expect(check.valid).toBe(true)

    const rows = await listWorkspace('/')
    expect(rows.some((row) => row.name === 'my-custom-dir')).toBe(true)
  })

  it('keeps strict root allowlist behavior when explicitly enabled', async () => {
    await fsp.mkdir(join(tempRoot, 'my-custom-dir'), { recursive: true })
    await fsp.mkdir(join(tempRoot, 'memory'), { recursive: true })
    await fsp.writeFile(join(tempRoot, 'AGENTS.md'), '# test')

    process.env.OPENCLAW_WORKSPACE = tempRoot
    process.env.CLAWCONTROL_WORKSPACE_ALLOWLIST_ONLY = '1'
    vi.resetModules()

    const { validateWorkspacePath } = await import('@/lib/fs/path-policy')
    const { listWorkspace } = await import('@/lib/fs/workspace-fs')

    const denied = validateWorkspacePath('/my-custom-dir')
    expect(denied.valid).toBe(false)

    const allowed = validateWorkspacePath('/memory')
    expect(allowed.valid).toBe(true)

    const rows = await listWorkspace('/')
    expect(rows.some((row) => row.name === 'my-custom-dir')).toBe(false)
    expect(rows.some((row) => row.name === 'memory')).toBe(true)
  })
})
