'use client'

import { ShieldCheck, ShieldAlert, ShieldX, ShieldQuestion } from 'lucide-react'
import { cn } from '@/lib/utils'

export type TrustLevel = 'unscanned' | 'scanned' | 'blocked' | 'verified'

export function TrustBadge(props: {
  level: TrustLevel
  title: string
  subtitle?: string
  className?: string
}) {
  const config = (() => {
    switch (props.level) {
      case 'verified':
        return {
          Icon: ShieldCheck,
          className: 'border-status-success/40 bg-status-success/10 text-status-success',
        }
      case 'scanned':
        return {
          Icon: ShieldAlert,
          className: 'border-status-info/40 bg-status-info/10 text-status-info',
        }
      case 'blocked':
        return {
          Icon: ShieldX,
          className: 'border-status-danger/40 bg-status-danger/10 text-status-danger',
        }
      case 'unscanned':
      default:
        return {
          Icon: ShieldQuestion,
          className: 'border-bd-1 bg-bg-3 text-fg-2',
        }
    }
  })()

  const tooltip = props.subtitle ? `${props.title}\n${props.subtitle}` : props.title

  return (
    <span
      title={tooltip}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-1 text-[11px] font-mono',
        config.className,
        props.className
      )}
    >
      <config.Icon className="w-3.5 h-3.5" />
      <span className="truncate">{props.title}</span>
    </span>
  )
}

