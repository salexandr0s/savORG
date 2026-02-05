'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CopyButton } from './copy-button'
import { highlightCodeToHtml } from './shiki-highlighter'

export interface CodeBlockProps {
  code: string
  language: string | null
  className?: string
  maxChars?: number
}

const DEFAULT_MAX_CHARS = 24_000

export function CodeBlock({
  code,
  language,
  className,
  maxChars = DEFAULT_MAX_CHARS,
}: CodeBlockProps) {
  const [html, setHtml] = useState<string | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  const langLabel = useMemo(() => (language || 'text').toLowerCase(), [language])
  const tooLarge = code.length > maxChars

  useEffect(() => {
    let cancelled = false

    async function run() {
      if (tooLarge) {
        setHtml(null)
        setStatus('ready')
        return
      }

      setStatus('loading')
      const out = await highlightCodeToHtml(code, language)
      if (cancelled) return

      if (out) {
        setHtml(out)
        setStatus('ready')
      } else {
        setHtml(null)
        setStatus('error')
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [code, language, tooLarge])

  return (
    <div className={cn('border border-bd-0 bg-bg-2 rounded-[var(--radius-md)] overflow-hidden', className)}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-bd-0 bg-bg-1">
        <span className="text-[10px] font-mono tracking-wider uppercase text-fg-2">
          {langLabel}
        </span>
        <CopyButton text={code} />
      </div>

      <div
        className={cn(
          'p-3 overflow-x-auto',
          'text-xs font-mono text-fg-0',
          '[&_pre]:bg-transparent [&_pre]:p-0 [&_pre]:m-0',
          '[&_code]:font-mono'
        )}
      >
        {status === 'loading' && (
          <div className="flex items-center gap-2 text-fg-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span className="text-xs">Highlighting…</span>
          </div>
        )}

        {html ? (
          <div dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="whitespace-pre">
            <code>{code}</code>
          </pre>
        )}

        {tooLarge && (
          <div className="mt-2 text-[10px] text-fg-3">
            Code block too large for highlighting — showing plain text.
          </div>
        )}
      </div>
    </div>
  )
}

