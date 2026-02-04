'use client'

import { cn } from '@/lib/utils'
import { LayoutList, Columns3 } from 'lucide-react'

export type ViewMode = 'table' | 'board'

interface ViewToggleProps {
  value: ViewMode
  onChange: (view: ViewMode) => void
  className?: string
}

export function ViewToggle({ value, onChange, className }: ViewToggleProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-[var(--radius-md)] bg-bg-2 border border-bd-0 p-0.5',
        className
      )}
    >
      <button
        type="button"
        onClick={() => onChange('table')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] transition-colors',
          value === 'table'
            ? 'bg-bg-3 text-fg-0'
            : 'text-fg-2 hover:text-fg-1'
        )}
        aria-pressed={value === 'table'}
      >
        <LayoutList className="w-3.5 h-3.5" />
        <span>Table</span>
      </button>
      <button
        type="button"
        onClick={() => onChange('board')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-[var(--radius-sm)] transition-colors',
          value === 'board'
            ? 'bg-bg-3 text-fg-0'
            : 'text-fg-2 hover:text-fg-1'
        )}
        aria-pressed={value === 'board'}
      >
        <Columns3 className="w-3.5 h-3.5" />
        <span>Board</span>
      </button>
    </div>
  )
}
