'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Send, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PromptInputProps {
  onSubmit: (value: string) => void | Promise<void>
  disabled?: boolean
  placeholder?: string
  maxLength?: number
  className?: string
  showCharCount?: boolean
}

const DEFAULT_MAX_LEN = 10_000
const MAX_HEIGHT_PX = 180

export function PromptInput({
  onSubmit,
  disabled = false,
  placeholder = 'Send a message…',
  maxLength = DEFAULT_MAX_LEN,
  className,
  showCharCount = true,
}: PromptInputProps) {
  const [value, setValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const canSend = useMemo(() => {
    return !disabled && !isSubmitting && value.trim().length > 0
  }, [disabled, isSubmitting, value])

  const resize = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [])

  useEffect(() => {
    resize()
  }, [value, resize])

  const submit = useCallback(async () => {
    if (!canSend) return

    const trimmed = value.trim()
    if (!trimmed) return

    setIsSubmitting(true)
    try {
      await onSubmit(trimmed)
      setValue('')
    } finally {
      setIsSubmitting(false)
      requestAnimationFrame(resize)
    }
  }, [canSend, onSubmit, resize, value])

  const onKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts newline. Cmd/Ctrl+Enter also sends.
    const isSubmitCombo = (e.key === 'Enter' && !e.shiftKey) || ((e.metaKey || e.ctrlKey) && e.key === 'Enter')
    if (!isSubmitCombo) return

    e.preventDefault()
    submit()
  }, [submit])

  return (
    <div className={cn('border-t border-bd-0 bg-bg-1 p-4', className)}>
      <div
        className={cn(
          'flex items-end gap-2 border rounded-[var(--radius-md)] px-2 py-2',
          disabled ? 'bg-bg-2 border-bd-0 opacity-80' : 'bg-bg-0 border-bd-1'
        )}
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled || isSubmitting}
          rows={1}
          maxLength={maxLength}
          className={cn(
            'flex-1 resize-none bg-transparent text-sm text-fg-0 placeholder:text-fg-3',
            'focus:outline-none min-h-[36px] max-h-[180px]',
            'font-mono'
          )}
        />

        {/* Clear */}
        {value.length > 0 && !disabled && (
          <button
            type="button"
            onClick={() => setValue('')}
            className="p-2 rounded-[var(--radius-md)] text-fg-2 hover:text-fg-0 hover:bg-bg-2 transition-colors"
            title="Clear"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        {/* Send */}
        <button
          type="button"
          disabled={!canSend}
          onClick={submit}
          className={cn(
            'p-2 rounded-[var(--radius-md)] transition-colors flex-shrink-0',
            canSend
              ? 'text-status-info hover:bg-status-info/10'
              : 'text-fg-3 cursor-not-allowed'
          )}
          title={disabled ? 'Disabled' : 'Send'}
        >
          <Send className="w-4.5 h-4.5" />
        </button>
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-fg-3">
        <span>
          Enter to send • Shift+Enter newline • Requires <span className="font-mono">CONFIRM</span>
        </span>
        {showCharCount && (
          <span className="font-mono text-fg-3/70">
            {value.length}/{maxLength}
          </span>
        )}
      </div>
    </div>
  )
}

