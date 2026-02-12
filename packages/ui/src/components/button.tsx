'use client'

import type { AnchorHTMLAttributes, ButtonHTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react'
import { cn } from '../theme'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'icon'

interface ButtonVariantOptions {
  variant?: ButtonVariant
  size?: ButtonSize
}

const baseButtonClass =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-info/40 disabled:opacity-50 disabled:cursor-not-allowed'

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-status-progress text-white border-status-progress hover:bg-status-progress/90 hover:border-status-progress/90',
  secondary:
    'bg-bg-2 text-fg-1 border-bd-0 hover:bg-bg-3 hover:text-fg-0 hover:border-bd-1',
  ghost:
    'bg-transparent text-fg-1 border-transparent hover:bg-bg-3 hover:text-fg-0',
  danger:
    'bg-status-danger/10 text-status-danger border-status-danger/30 hover:bg-status-danger/20',
}

const sizeClasses: Record<ButtonSize, string> = {
  xs: 'px-2 py-1 text-xs',
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3 py-1.5 text-sm',
  icon: 'h-7 w-7 p-0 text-xs',
}

export function buttonVariants(options: ButtonVariantOptions = {}): string {
  const variant = options.variant ?? 'secondary'
  const size = options.size ?? 'sm'
  return cn(baseButtonClass, variantClasses[variant], sizeClasses[size])
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
}

export function Button({
  children,
  variant = 'secondary',
  size = 'sm',
  className,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </button>
  )
}

type ButtonLikeElement = HTMLAnchorElement | HTMLLabelElement
type ButtonLikeProps = AnchorHTMLAttributes<HTMLAnchorElement> | LabelHTMLAttributes<HTMLLabelElement>

export interface ButtonLikeClassOptions extends ButtonVariantOptions {
  className?: string
}

export function buttonLikeClass(options: ButtonLikeClassOptions = {}): string {
  return cn(buttonVariants(options), options.className)
}

export type { ButtonLikeElement, ButtonLikeProps }
