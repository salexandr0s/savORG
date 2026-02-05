'use client'

import { AppShell } from '@/components/shell/app-shell'
import { SearchModal, useSearchModal } from '@/components/shell/search-modal'
import { ProtectedActionProvider } from '@/components/protected-action-modal'
import { usePathname } from 'next/navigation'

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
  const isConsoleRoute = pathname === '/console' || pathname.startsWith('/console/')

  return (
    <ProtectedActionProvider>
      <AppShell
        onSearchClick={search.onOpen}
        contentPadding={isConsoleRoute ? 'none' : 'default'}
      >
        {children}
      </AppShell>
      <SearchModal open={search.open} onClose={search.onClose} />
    </ProtectedActionProvider>
  )
}
