import { afterEach, describe, expect, it, vi } from 'vitest'
import { promises as fsp } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

describe('database initialization', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL
  const originalMigrationsDir = process.env.CLAWCONTROL_MIGRATIONS_DIR

  afterEach(async () => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = originalDatabaseUrl

    if (originalMigrationsDir === undefined) delete process.env.CLAWCONTROL_MIGRATIONS_DIR
    else process.env.CLAWCONTROL_MIGRATIONS_DIR = originalMigrationsDir

    delete (globalThis as { prisma?: unknown }).prisma
    vi.resetModules()
  })

  it('creates and migrates a fresh sqlite database on first initialization', async () => {
    const tempRoot = join(tmpdir(), `db-init-success-${randomUUID()}`)
    const dbPath = join(tempRoot, 'fresh.db')
    await fsp.mkdir(tempRoot, { recursive: true })

    process.env.DATABASE_URL = `file:${dbPath}`
    process.env.CLAWCONTROL_MIGRATIONS_DIR = join(process.cwd(), 'prisma', 'migrations')

    delete (globalThis as { prisma?: unknown }).prisma
    vi.resetModules()

    const mod = await import('@/lib/db/init')
    const status = await mod.ensureDatabaseInitialized()

    expect(status.ok).toBe(true)
    expect(status.initialized).toBe(true)
    expect(status.code).toBeNull()
    await expect(fsp.stat(dbPath)).resolves.toBeDefined()

    await fsp.rm(tempRoot, { recursive: true, force: true })
  })

  it('returns DB_MIGRATION_FAILED when schema is missing and migrations directory is unavailable', async () => {
    const tempRoot = join(tmpdir(), `db-init-${randomUUID()}`)
    const dbPath = join(tempRoot, 'fresh.db')
    const emptyMigrationsDir = join(tempRoot, 'empty-migrations')
    await fsp.mkdir(tempRoot, { recursive: true })
    await fsp.mkdir(emptyMigrationsDir, { recursive: true })

    process.env.DATABASE_URL = `file:${dbPath}`
    process.env.CLAWCONTROL_MIGRATIONS_DIR = emptyMigrationsDir

    delete (globalThis as { prisma?: unknown }).prisma
    vi.resetModules()

    const mod = await import('@/lib/db/init')
    const status = await mod.ensureDatabaseInitialized()

    expect(status.ok).toBe(false)
    expect(status.code).toBe('DB_MIGRATION_FAILED')
    expect(status.message).toContain('migration')

    await fsp.rm(tempRoot, { recursive: true, force: true })
  })
})
