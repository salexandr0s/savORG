'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface CopyButtonProps {
  text: string
  className?: string
  variant?: 'default' | 'ghost'
}

async function copyToClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  // Fallback
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

export function CopyButton({ text, className, variant = 'default' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const label = useMemo(() => (copied ? 'Copied' : 'Copy'), [copied])

  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(t)
  }, [copied])

  const onCopy = useCallback(async () => {
    try {
      await copyToClipboard(text)
      setCopied(true)
    } catch {
      // ignore
    }
  }, [text])

  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium rounded-[var(--radius-sm)] transition-colors',
        variant === 'default' && 'bg-bg-2 text-fg-1 hover:text-fg-0 hover:bg-bg-3 border border-bd-0',
        variant === 'ghost' && 'text-fg-2 hover:text-fg-0 hover:bg-bg-2',
        className
      )}
      title={label}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      <span>{label}</span>
    </button>
  )
}

