'use client'

import { useEffect, useState } from 'react'
import type { Route } from 'next'
import { AppShell } from '@/components/shell/app-shell'
import { SearchModal, useSearchModal } from '@/components/shell/search-modal'
import { ProtectedActionProvider } from '@/components/protected-action-modal'
import { SyncBanner } from '@/components/sync-banner'
import { usePathname, useRouter } from 'next/navigation'

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
        const res = await fetch('/api/system/init-status', { cache: 'no-store' })
        const payload = (await res.json().catch(() => null)) as {
          data?: { requiresSetup?: boolean }
        } | null

        if (canceled) return

        if (payload?.data?.requiresSetup) {
          router.replace('/setup' as Route)
          return
        }

        setGuardReady(true)
      } catch {
        // Fail-open for layout rendering if the status endpoint errors.
        setGuardReady(true)
      }
    }

    setGuardReady(false)
    void checkSetup()

    return () => {
      canceled = true
    }
  }, [pathname, router])

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
