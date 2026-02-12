'use client'

import type { ReactNode } from 'react'
import { Button, buttonVariants } from './button'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  sticky?: boolean
  className?: string
}

/**
 * PageHeader - Consistent header for all pages
 *
 * Provides title, optional subtitle, and action slot.
 * Can be sticky for scrolling pages.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  sticky = false,
  className,
}: PageHeaderProps) {
  const baseClass = [
    'flex items-start justify-between gap-4 pb-4',
    sticky && 'sticky top-0 z-10 pt-4 -mt-4 bg-bg-0',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <header className={baseClass}>
      <div className="min-w-0">
        <h1 className="text-lg font-semibold text-fg-0 truncate">{title}</h1>
        {subtitle && (
          <p className="text-sm text-fg-2 mt-0.5 truncate">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  )
}

/**
 * PageSection - Section within a page with title
 */
interface PageSectionProps {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export function PageSection({
  title,
  description,
  actions,
  children,
  className,
}: PageSectionProps) {
  return (
    <section className={className}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-fg-0">{title}</h2>
          {description && (
            <p className="text-xs text-fg-2 mt-0.5">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

/**
 * EmptyState - Placeholder for empty lists/tables
 */
interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={[
        'flex flex-col items-center justify-center py-12 text-center',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {icon && <div className="text-fg-3 mb-3">{icon}</div>}
      <h3 className="text-sm font-medium text-fg-1">{title}</h3>
      {description && (
        <p className="text-xs text-fg-2 mt-1 max-w-xs">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/**
 * ActionButton - Standard button for page actions
 */
interface ActionButtonProps {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean
  className?: string
}

export function ActionButton({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  className,
}: ActionButtonProps) {
  return (
    <Button
      onClick={onClick}
      disabled={disabled}
      variant={variant}
      size="sm"
      className={className}
    >
      {children}
    </Button>
  )
}

/**
 * DisabledAction - Button that's disabled with a phase tooltip
 */
interface DisabledActionProps {
  children: ReactNode
  phase: string
  className?: string
}

export function DisabledAction({
  children,
  phase,
  className,
}: DisabledActionProps) {
  return (
    <button
      disabled
      title={`Available in ${phase}`}
      className={[
        buttonVariants({ variant: 'secondary', size: 'sm' }),
        'text-fg-3 cursor-not-allowed opacity-70',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </button>
  )
}
