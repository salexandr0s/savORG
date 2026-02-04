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
    const { enableWalMode } = await import('./lib/db')
    await enableWalMode()
    console.log('[boot] WAL mode enabled')
  }
}
