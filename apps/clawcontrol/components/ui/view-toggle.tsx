'use client'

import { SegmentedToggle } from '@clawcontrol/ui'
import { LayoutList, Columns3 } from 'lucide-react'

export type ViewMode = 'table' | 'board'

interface ViewToggleProps {
  value: ViewMode
  onChange: (view: ViewMode) => void
  className?: string
}

export function ViewToggle({ value, onChange, className }: ViewToggleProps) {
  const items = [
    {
      value: 'board' as const,
      label: (
        <>
          <Columns3 className="w-3.5 h-3.5" />
          <span>Board</span>
        </>
      ),
    },
    {
      value: 'table' as const,
      label: (
        <>
          <LayoutList className="w-3.5 h-3.5" />
          <span>Table</span>
        </>
      ),
    },
  ]

  return (
    <SegmentedToggle
      value={value}
      onChange={onChange}
      items={items}
      tone="neutral"
      className={className}
      ariaLabel="View mode"
    />
  )
}
