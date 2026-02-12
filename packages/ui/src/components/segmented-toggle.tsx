'use client'

import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '../theme'

export type SegmentedToggleTone = 'neutral' | 'accent'
export type SegmentedToggleSize = 'xs' | 'sm'

export interface SegmentedToggleItem<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
  title?: string
}

interface SegmentedToggleProps<T extends string> {
  value: T
  onChange: (value: T) => void
  items: ReadonlyArray<SegmentedToggleItem<T>>
  tone?: SegmentedToggleTone
  size?: SegmentedToggleSize
  className?: string
  ariaLabel?: string
}

const containerClass =
  'inline-flex items-center gap-1 rounded-[var(--radius-md)] bg-bg-2 border border-bd-0 p-0.5'

const itemBaseClass =
  'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

const itemSizeClass: Record<SegmentedToggleSize, string> = {
  xs: 'px-2 py-1 text-xs',
  sm: 'px-2.5 py-1.5 text-xs',
}

const inactiveClass = 'text-fg-2 hover:text-fg-1'

const activeClassByTone: Record<SegmentedToggleTone, string> = {
  neutral: 'bg-bg-3 text-fg-0',
  accent: 'bg-status-progress text-white',
}

function getNextEnabledIndex<T extends string>(
  items: ReadonlyArray<SegmentedToggleItem<T>>,
  startIndex: number,
  direction: 1 | -1
): number {
  let index = startIndex
  for (let i = 0; i < items.length; i += 1) {
    index = (index + direction + items.length) % items.length
    if (!items[index]?.disabled) return index
  }
  return startIndex
}

export function SegmentedToggle<T extends string>({
  value,
  onChange,
  items,
  tone = 'neutral',
  size = 'sm',
  className,
  ariaLabel,
}: SegmentedToggleProps<T>) {
  const currentIndex = items.findIndex((item) => item.value === value)

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) return
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') {
      return
    }

    event.preventDefault()

    if (event.key === 'Home') {
      const firstEnabled = items.find((item) => !item.disabled)
      if (firstEnabled) onChange(firstEnabled.value)
      return
    }

    if (event.key === 'End') {
      for (let i = items.length - 1; i >= 0; i -= 1) {
        if (!items[i]?.disabled) {
          onChange(items[i].value)
          return
        }
      }
      return
    }

    const direction: 1 | -1 = event.key === 'ArrowRight' ? 1 : -1
    const startIndex = currentIndex < 0 ? 0 : currentIndex
    const nextIndex = getNextEnabledIndex(items, startIndex, direction)
    const nextItem = items[nextIndex]
    if (nextItem && !nextItem.disabled) {
      onChange(nextItem.value)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(containerClass, className)}
      onKeyDown={handleKeyDown}
    >
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            disabled={item.disabled}
            title={item.title}
            className={cn(
              itemBaseClass,
              itemSizeClass[size],
              active ? activeClassByTone[tone] : inactiveClass
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
