import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import {
  type ClawcontrolSettings,
  type SettingsReadResult,
} from './types'

const LEGACY_ENV_KEYS = [
  'OPENCLAW_WORKSPACE',
  'OPENCLAW_GATEWAY_HTTP_URL',
  'OPENCLAW_GATEWAY_WS_URL',
  'OPENCLAW_GATEWAY_TOKEN',
] as const

type LegacyEnvValues = {
  OPENCLAW_WORKSPACE?: string
  OPENCLAW_GATEWAY_HTTP_URL?: string
  OPENCLAW_GATEWAY_WS_URL?: string
  OPENCLAW_GATEWAY_TOKEN?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') return undefined

  const trimmed = value.trim().toLowerCase()
  if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes' || trimmed === 'on') return true
  if (trimmed === 'false' || trimmed === '0' || trimmed === 'no' || trimmed === 'off') return false
  return undefined
}

function parseSettingsRecord(input: unknown): ClawcontrolSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { updatedAt: nowIso() }
  }

  const record = input as Record<string, unknown>
  const updatedAt = normalizeString(record.updatedAt) ?? nowIso()

  return {
    ...(normalizeString(record.gatewayHttpUrl) ? { gatewayHttpUrl: normalizeString(record.gatewayHttpUrl) } : {}),
    ...(normalizeString(record.gatewayWsUrl) ? { gatewayWsUrl: normalizeString(record.gatewayWsUrl) } : {}),
    ...(normalizeString(record.gatewayToken) ? { gatewayToken: normalizeString(record.gatewayToken) } : {}),
    ...(normalizeString(record.workspacePath) ? { workspacePath: normalizeString(record.workspacePath) } : {}),
    ...(normalizeBoolean(record.setupCompleted) !== undefined
      ? { setupCompleted: normalizeBoolean(record.setupCompleted) }
      : {}),
    updatedAt,
  }
}

function parseEnvFile(content: string): LegacyEnvValues {
  const out: LegacyEnvValues = {}
  const lines = content.split(/\r?\n/)

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!match) continue

    const key = match[1]
    const rawValue = match[2] ?? ''

    if (!LEGACY_ENV_KEYS.includes(key as (typeof LEGACY_ENV_KEYS)[number])) {
      continue
    }

    const stripped = rawValue
      .replace(/^\s+/, '')
      .replace(/\s+$/, '')
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1')

    const normalized = normalizeString(stripped)
    if (!normalized) continue

    ;(out as Record<string, string>)[key] = normalized
  }

  return out
}

function readLegacyEnvSync(envPath: string): LegacyEnvValues {
  try {
    if (!fs.existsSync(envPath)) return {}
    const content = fs.readFileSync(envPath, 'utf8')
    return parseEnvFile(content)
  } catch {
    return {}
  }
}

async function readLegacyEnv(envPath: string): Promise<LegacyEnvValues> {
  try {
    const content = await fsp.readFile(envPath, 'utf8')
    return parseEnvFile(content)
  } catch {
    return {}
  }
}

function withLegacyFallback(settings: ClawcontrolSettings, legacyEnv: LegacyEnvValues): {
  settings: ClawcontrolSettings
  migrated: boolean
} {
  const next: ClawcontrolSettings = { ...settings }
  let migrated = false

  if (!next.workspacePath && legacyEnv.OPENCLAW_WORKSPACE) {
    next.workspacePath = legacyEnv.OPENCLAW_WORKSPACE
    migrated = true
  }

  if (!next.gatewayHttpUrl && legacyEnv.OPENCLAW_GATEWAY_HTTP_URL) {
    next.gatewayHttpUrl = legacyEnv.OPENCLAW_GATEWAY_HTTP_URL
    migrated = true
  }

  if (!next.gatewayWsUrl && legacyEnv.OPENCLAW_GATEWAY_WS_URL) {
    next.gatewayWsUrl = legacyEnv.OPENCLAW_GATEWAY_WS_URL
    migrated = true
  }

  if (!next.gatewayToken && legacyEnv.OPENCLAW_GATEWAY_TOKEN) {
    next.gatewayToken = legacyEnv.OPENCLAW_GATEWAY_TOKEN
    migrated = true
  }

  if (migrated) {
    next.updatedAt = nowIso()
  }

  return { settings: next, migrated }
}

function toSettingsPath(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return resolve(process.cwd(), 'settings.json')
  return isAbsolute(trimmed) ? trimmed : resolve(process.cwd(), trimmed)
}

export function getSettingsPath(): string {
  const explicitPath = normalizeString(process.env.CLAWCONTROL_SETTINGS_PATH)
  if (explicitPath) return toSettingsPath(explicitPath)

  const userDataDir = normalizeString(process.env.CLAWCONTROL_USER_DATA_DIR)
  if (userDataDir) {
    return join(userDataDir, 'settings.json')
  }

  return join(homedir(), '.openclaw', 'clawcontrol', 'settings.json')
}

export function getLegacyEnvPath(): string {
  return resolve(process.cwd(), '.env')
}

function readSettingsFileSync(path: string): ClawcontrolSettings {
  try {
    if (!fs.existsSync(path)) return { updatedAt: nowIso() }
    const raw = fs.readFileSync(path, 'utf8')
    return parseSettingsRecord(JSON.parse(raw))
  } catch {
    return { updatedAt: nowIso() }
  }
}

async function readSettingsFile(path: string): Promise<ClawcontrolSettings> {
  try {
    const raw = await fsp.readFile(path, 'utf8')
    return parseSettingsRecord(JSON.parse(raw))
  } catch {
    return { updatedAt: nowIso() }
  }
}

function writeSettingsFileSync(path: string, settings: ClawcontrolSettings): void {
  fs.mkdirSync(dirname(path), { recursive: true })
  fs.writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

async function writeSettingsFile(path: string, settings: ClawcontrolSettings): Promise<void> {
  await fsp.mkdir(dirname(path), { recursive: true })
  await fsp.writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
}

export function readSettingsSync(): SettingsReadResult {
  const settingsPath = getSettingsPath()
  const legacyEnvPath = getLegacyEnvPath()

  const current = readSettingsFileSync(settingsPath)
  const legacy = readLegacyEnvSync(legacyEnvPath)
  const merged = withLegacyFallback(current, legacy)

  if (merged.migrated) {
    try {
      writeSettingsFileSync(settingsPath, merged.settings)
    } catch {
      // Ignore write failures in sync fallback mode.
    }
  }

  return {
    settings: merged.settings,
    path: settingsPath,
    migratedFromEnv: merged.migrated,
    legacyEnvPath: fs.existsSync(legacyEnvPath) ? legacyEnvPath : null,
  }
}

export async function readSettings(): Promise<SettingsReadResult> {
  const settingsPath = getSettingsPath()
  const legacyEnvPath = getLegacyEnvPath()

  const current = await readSettingsFile(settingsPath)
  const legacy = await readLegacyEnv(legacyEnvPath)
  const merged = withLegacyFallback(current, legacy)

  if (merged.migrated) {
    try {
      await writeSettingsFile(settingsPath, merged.settings)
    } catch {
      // Keep runtime settings even if persistence fails.
    }
  }

  return {
    settings: merged.settings,
    path: settingsPath,
    migratedFromEnv: merged.migrated,
    legacyEnvPath: fs.existsSync(legacyEnvPath) ? legacyEnvPath : null,
  }
}

export async function writeSettings(next: Partial<ClawcontrolSettings>): Promise<SettingsReadResult> {
  const current = await readSettings()
  const mergedRaw: Record<string, unknown> = {
    ...current.settings,
    ...next,
    updatedAt: nowIso(),
  }
  const merged = parseSettingsRecord(mergedRaw)

  await writeSettingsFile(current.path, merged)

  return {
    ...current,
    settings: merged,
    migratedFromEnv: current.migratedFromEnv,
  }
}

export async function setSetupCompleted(setupCompleted: boolean): Promise<SettingsReadResult> {
  return writeSettings({ setupCompleted })
}
