/**
 * Next.js Instrumentation Hook
 *
 * Runs once at process startup (before any routes are handled).
 * Used to initialize critical DB settings like WAL mode.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { enableWalMode, ensureReservedWorkOrders } = await import('./lib/db')
    const { ensureDatabaseInitialized } = await import('./lib/db/init')
    const { bootSync } = await import('./lib/boot-sync')
    const dbStatus = await ensureDatabaseInitialized()

    if (!dbStatus.ok) {
      console.warn('[boot] DB initialization reported issues:', {
        code: dbStatus.code,
        message: dbStatus.message,
        databasePath: dbStatus.databasePath,
      })
    } else {
      console.log('[boot] DB initialized')
    }

    await enableWalMode()
    console.log('[boot] WAL mode enabled')

    try {
      await ensureReservedWorkOrders()
      console.log('[boot] Reserved work orders ensured')
    } catch (err) {
      console.warn(
        '[boot] Reserved work order bootstrap skipped:',
        err instanceof Error ? err.message : String(err)
      )
    }

    const syncResult = await bootSync()
    const hasErrors = Boolean(syncResult.agents.error || syncResult.sessions.error)
    if (hasErrors) {
      console.warn('[boot] OpenClaw sync completed with errors:', {
        agents: syncResult.agents.error ?? null,
        sessions: syncResult.sessions.error ?? null,
      })
    } else {
      console.log(
        `[boot] OpenClaw sync OK: agents=${syncResult.agents.count}, sessions=${syncResult.sessions.count}`
      )
    }
  }
}
