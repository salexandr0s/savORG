import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveHierarchySourcePaths } from '@/lib/services/agent-hierarchy'

describe('hierarchy source path discovery', () => {
  it('discovers nested ClawControl config under workspace projects directory', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'hierarchy-source-paths-'))

    try {
      const workspaceRoot = join(tempRoot, 'OpenClaw')
      const clawcontrolRoot = join(workspaceRoot, 'projects', 'ClawControl')
      const fallbackDir = join(clawcontrolRoot, 'openclaw')

      await mkdir(fallbackDir, { recursive: true })
      await writeFile(join(clawcontrolRoot, 'clawcontrol.config.yaml'), 'agents: {}\n', 'utf-8')
      await writeFile(join(fallbackDir, 'openclaw.json5'), '{ agents: { list: [] } }', 'utf-8')

      const resolved = resolveHierarchySourcePaths({
        env: {
          OPENCLAW_WORKSPACE: workspaceRoot,
        },
        cwd: join(clawcontrolRoot, 'apps', 'clawcontrol'),
      })

      expect(resolved.workspaceRoot).toBe(workspaceRoot)
      expect(resolved.yamlPath).toBe(join(clawcontrolRoot, 'clawcontrol.config.yaml'))
      expect(resolved.fallbackPath).toBe(join(fallbackDir, 'openclaw.json5'))
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
