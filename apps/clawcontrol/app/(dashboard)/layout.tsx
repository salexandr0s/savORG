'use client'

import { useEffect, useState } from 'react'
import type { Route } from 'next'
import { AppShell } from '@/components/shell/app-shell'
import { SearchModal, useSearchModal } from '@/components/shell/search-modal'
import { ProtectedActionProvider } from '@/components/protected-action-modal'
import { SyncBanner } from '@/components/sync-banner'
import { usePathname, useRouter } from 'next/navigation'

const INIT_STATUS_CACHE_TTL_MS = 15_000
let initStatusCache: { requiresSetup: boolean; expiresAt: number } | null = null

async function getRequiresSetup(): Promise<boolean> {
  const now = Date.now()
  if (initStatusCache && initStatusCache.expiresAt > now) {
    return initStatusCache.requiresSetup
  }

  const res = await fetch('/api/system/init-status', { cache: 'no-store' })
  const payload = (await res.json().catch(() => null)) as {
    data?: { requiresSetup?: boolean }
  } | null

  const requiresSetup = payload?.data?.requiresSetup === true
  initStatusCache = {
    requiresSetup,
    expiresAt: now + INIT_STATUS_CACHE_TTL_MS,
  }

  return requiresSetup
}

/**
 * Dashboard Layout
 *
 * Wraps all main application routes with the AppShell.
 * Includes global search modal with Cmd/Ctrl+K shortcut.
 * Provides protected action modal for Governor-enforced confirmations.
 */
export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const search = useSearchModal()
  const pathname = usePathname()
  const router = useRouter()
  const isConsoleRoute = pathname === '/console' || pathname.startsWith('/console/')
  const [guardReady, setGuardReady] = useState(false)

  useEffect(() => {
    let canceled = false

    async function checkSetup() {
      try {
        const requiresSetup = await getRequiresSetup()
        if (canceled) return
        if (requiresSetup) {
          router.replace('/setup' as Route)
          return
        }

        setGuardReady(true)
      } catch {
        // Fail-open for layout rendering if the status endpoint errors.
        setGuardReady(true)
      }
    }

    void checkSetup()

    return () => {
      canceled = true
    }
  }, [router])

  if (!guardReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-0 text-fg-2">
        Loading setup status...
      </div>
    )
  }

  return (
    <ProtectedActionProvider>
      <AppShell
        onSearchClick={search.onOpen}
        contentPadding={isConsoleRoute ? 'none' : 'default'}
      >
        {isConsoleRoute ? (
          <div className="relative h-full">
            <div className="pointer-events-none absolute inset-x-3 top-3 z-20">
              <SyncBanner withMargin={false} className="pointer-events-auto" />
            </div>
            {children}
          </div>
        ) : (
          <>
            <SyncBanner />
            {children}
          </>
        )}
      </AppShell>
      <SearchModal open={search.open} onClose={search.onClose} />
    </ProtectedActionProvider>
  )
}
