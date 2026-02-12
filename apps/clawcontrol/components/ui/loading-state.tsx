'use client'

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'

const spinnerSizeClass: Record<SpinnerSize, string> = {
  xs: 'w-3 h-3',
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
  xl: 'w-6 h-6',
  '2xl': 'w-8 h-8',
  '3xl': 'w-12 h-12',
}

type LoadingStateHeight = 'auto' | 'sm' | 'md' | 'lg' | 'full' | 'viewport'

const loadingHeightClass: Record<LoadingStateHeight, string> = {
  auto: '',
  sm: 'h-40',
  md: 'h-64',
  lg: 'h-80',
  full: 'h-full',
  viewport: 'min-h-[calc(100dvh-var(--topbar-height)-1.5rem)] sm:min-h-[calc(100dvh-var(--topbar-height)-2rem)]',
}

interface LoadingSpinnerProps {
  size?: SpinnerSize
  className?: string
}

export function LoadingSpinner({
  size = 'md',
  className,
}: LoadingSpinnerProps) {
  return (
    <Loader2
      className={cn('animate-spin shrink-0', spinnerSizeClass[size], className)}
      aria-hidden="true"
    />
  )
}

interface LoadingStateProps {
  label?: string
  description?: string
  size?: SpinnerSize
  height?: LoadingStateHeight
  className?: string
  spinnerClassName?: string
  labelClassName?: string
  descriptionClassName?: string
}

export function LoadingState({
  label = 'Loading...',
  description,
  size = 'xl',
  height = 'md',
  className,
  spinnerClassName,
  labelClassName,
  descriptionClassName,
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex flex-col items-center justify-center gap-2 text-center',
        loadingHeightClass[height],
        className
      )}
    >
      <LoadingSpinner size={size} className={cn('text-fg-2', spinnerClassName)} />
      {label ? (
        <p className={cn('text-sm text-fg-2', labelClassName)}>{label}</p>
      ) : null}
      {description ? (
        <p className={cn('text-xs text-fg-3 max-w-sm', descriptionClassName)}>
          {description}
        </p>
      ) : null}
    </div>
  )
}

interface InlineLoadingProps {
  label?: string
  size?: SpinnerSize
  className?: string
  spinnerClassName?: string
}

export function InlineLoading({
  label = 'Loading...',
  size = 'md',
  className,
  spinnerClassName,
}: InlineLoadingProps) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={cn('inline-flex items-center gap-2 text-sm text-fg-2', className)}
    >
      <LoadingSpinner size={size} className={spinnerClassName} />
      <span>{label}</span>
    </span>
  )
}
