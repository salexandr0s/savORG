'use client'

import { useState, useCallback, type FormEvent, type KeyboardEvent } from 'react'
import { Send, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'

// ============================================================================
// TYPES
// ============================================================================

interface SendFormProps {
  onSend: (content: string) => void
  disabled: boolean
  placeholder: string
}

// ============================================================================
// COMPONENT
// ============================================================================

export function SendForm({ onSend, disabled, placeholder }: SendFormProps) {
  const [content, setContent] = useState('')

  const handleSubmit = useCallback((e: FormEvent) => {
    e.preventDefault()
    if (disabled || !content.trim()) return
    onSend(content.trim())
    setContent('')
  }, [content, disabled, onSend])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + Enter to send
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      if (!disabled && content.trim()) {
        onSend(content.trim())
        setContent('')
      }
    }
  }, [content, disabled, onSend])

  return (
    <form onSubmit={handleSubmit} className="border-t border-bd-0 p-4 bg-bg-1">
      <div className={cn(
        'flex items-end gap-3 rounded-lg border p-2',
        disabled ? 'border-status-danger/30 bg-bg-2' : 'border-bd-1 bg-bg-0'
      )}>
        {/* Input */}
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className={cn(
            'flex-1 resize-none bg-transparent text-sm text-fg-0',
            'placeholder:text-fg-3 focus:outline-none',
            'min-h-[24px] max-h-[120px]',
            disabled && 'cursor-not-allowed opacity-50'
          )}
          style={{
            height: 'auto',
            overflow: 'hidden',
          }}
          ref={(el) => {
            if (el) {
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`
            }
          }}
        />

        {/* Send button */}
        <button
          type="submit"
          disabled={disabled || !content.trim()}
          className={cn(
            'p-2 rounded-lg transition-colors flex-shrink-0',
            disabled || !content.trim()
              ? 'text-fg-3 cursor-not-allowed'
              : 'text-status-info hover:bg-status-info/10'
          )}
        >
          {disabled ? (
            <Lock className="w-5 h-5" />
          ) : (
            <Send className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Helper text */}
      <div className="mt-2 flex flex-col gap-1 text-xs text-fg-3">
        <div className="flex items-center justify-between">
          <span>
            {disabled
              ? placeholder.includes('Select a session')
                ? 'Select a session from the list to send messages'
                : 'Sending disabled while gateway unavailable'
              : 'Press Ctrl+Enter to send • Requires CONFIRM'
            }
          </span>
          {!disabled && (
            <span className="text-fg-3/70">
              {content.length}/10000
            </span>
          )}
        </div>
        {!disabled && (
          <span className="text-fg-3/60 text-[10px]">
            Sends via WebSocket to session. TRUE session injection.
          </span>
        )}
      </div>
    </form>
  )
}
