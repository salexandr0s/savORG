import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

describe('settings store', () => {
  const originalHome = process.env.HOME
  const originalSettingsPath = process.env.CLAWCONTROL_SETTINGS_PATH
  const originalCwd = process.cwd()

  let tempRoot = ''
  let fakeHome = ''
  let settingsPath = ''

  beforeEach(async () => {
    tempRoot = join(tmpdir(), `settings-store-${randomUUID()}`)
    fakeHome = join(tempRoot, 'home')
    settingsPath = join(tempRoot, 'settings.json')

    await fsp.mkdir(fakeHome, { recursive: true })
    process.env.HOME = fakeHome
    process.env.CLAWCONTROL_SETTINGS_PATH = settingsPath
    process.chdir(tempRoot)
    vi.resetModules()
  })

  afterEach(async () => {
    process.chdir(originalCwd)
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome

    if (originalSettingsPath === undefined) delete process.env.CLAWCONTROL_SETTINGS_PATH
    else process.env.CLAWCONTROL_SETTINGS_PATH = originalSettingsPath

    vi.resetModules()
    await fsp.rm(tempRoot, { recursive: true, force: true })
  })

  it('migrates one-time legacy .env values into settings.json', async () => {
    await fsp.writeFile(
      join(tempRoot, '.env'),
      [
        'OPENCLAW_WORKSPACE="/tmp/workspace"',
        'OPENCLAW_GATEWAY_HTTP_URL="http://127.0.0.1:2999"',
        'OPENCLAW_GATEWAY_TOKEN="abc123"',
      ].join('\n')
    )

    const mod = await import('@/lib/settings/store')
    const result = await mod.readSettings()

    expect(result.migratedFromEnv).toBe(true)
    expect(result.settings.workspacePath).toBe('/tmp/workspace')
    expect(result.settings.gatewayHttpUrl).toBe('http://127.0.0.1:2999')
    expect(result.settings.gatewayToken).toBe('abc123')

    const saved = JSON.parse(await fsp.readFile(settingsPath, 'utf8')) as Record<string, unknown>
    expect(saved.workspacePath).toBe('/tmp/workspace')
    expect(saved.gatewayHttpUrl).toBe('http://127.0.0.1:2999')
  })

  it('persists updates and clears nullable fields', async () => {
    const mod = await import('@/lib/settings/store')

    await mod.writeSettings({
      gatewayHttpUrl: 'http://127.0.0.1:18789',
      workspacePath: '/tmp/a',
      setupCompleted: true,
    })

    await mod.writeSettings({
      gatewayHttpUrl: null as unknown as string,
      workspacePath: '/tmp/b',
      setupCompleted: false,
    })

    const result = await mod.readSettings()
    expect(result.settings.workspacePath).toBe('/tmp/b')
    expect(result.settings.setupCompleted).toBe(false)
    expect(result.settings.gatewayHttpUrl).toBeUndefined()
  })
})
