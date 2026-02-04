'use client'

import { useRef, useEffect } from 'react'
import { Terminal, Bot, User, AlertCircle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SendForm } from './send-form'
import type { ConsoleSessionDTO } from '@/app/api/openclaw/console/sessions/route'
import type { ChatMessage } from '../console-client'

// ============================================================================
// TYPES
// ============================================================================

interface ChatPanelProps {
  session: ConsoleSessionDTO | null
  messages: ChatMessage[]
  onSend: (content: string) => void
  streaming: boolean
  sendDisabled: boolean
}

// ============================================================================
// HELPERS
// ============================================================================

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ============================================================================
// MESSAGE BUBBLE
// ============================================================================

function MessageBubble({ message }: { message: ChatMessage }) {
  const isOperator = message.role === 'operator'
  const isSystem = message.role === 'system'

  return (
    <div className={cn(
      'flex gap-3',
      isOperator ? 'flex-row-reverse' : 'flex-row'
    )}>
      {/* Avatar */}
      <div className={cn(
        'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0',
        isOperator ? 'bg-status-info/20' : isSystem ? 'bg-bg-3' : 'bg-status-progress/20'
      )}>
        {isOperator ? (
          <User className="w-4 h-4 text-status-info" />
        ) : isSystem ? (
          <Terminal className="w-4 h-4 text-fg-3" />
        ) : (
          <Bot className="w-4 h-4 text-status-progress" />
        )}
      </div>

      {/* Content */}
      <div className={cn(
        'max-w-[70%] flex flex-col',
        isOperator ? 'items-end' : 'items-start'
      )}>
        {/* Bubble */}
        <div className={cn(
          'px-4 py-2.5 rounded-2xl',
          isOperator
            ? 'bg-status-info text-white rounded-br-sm'
            : isSystem
              ? 'bg-bg-2 text-fg-1 rounded-bl-sm'
              : 'bg-bg-3 text-fg-0 rounded-bl-sm',
          message.pending && 'opacity-70',
          message.error && 'border-2 border-status-danger'
        )}>
          {/* Content */}
          <div className="text-sm whitespace-pre-wrap break-words">
            {message.content || (message.streaming && (
              <span className="flex items-center gap-2 text-fg-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Thinking...</span>
              </span>
            ))}
          </div>

          {/* Streaming indicator */}
          {message.streaming && message.content && (
            <div className="mt-1 flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-status-progress rounded-full animate-pulse" />
              <span className="text-xs text-fg-3">Streaming...</span>
            </div>
          )}
        </div>

        {/* Meta info */}
        <div className={cn(
          'flex items-center gap-2 mt-1 text-xs text-fg-3',
          isOperator ? 'flex-row-reverse' : 'flex-row'
        )}>
          <span>{formatTime(message.timestamp)}</span>
          {message.pending && (
            <>
              <span className="text-fg-3/50">·</span>
              <span className="flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Sending...
              </span>
            </>
          )}
          {message.error && (
            <>
              <span className="text-fg-3/50">·</span>
              <span className="flex items-center gap-1 text-status-danger">
                <AlertCircle className="w-3 h-3" />
                {message.error}
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ChatPanel({
  session,
  messages,
  onSend,
  streaming,
  sendDisabled,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Determine if input should be disabled
  const noSession = !session
  const inputDisabled = noSession || sendDisabled || streaming

  // Determine placeholder text
  const getPlaceholder = () => {
    if (noSession) return 'Select a session to send a message...'
    if (sendDisabled) return 'Gateway unavailable — cannot send'
    if (streaming) return 'Waiting for response...'
    return `Send to ${session.sessionKey || session.agentId}...`
  }

  return (
    <div className="flex-1 flex flex-col bg-bg-0">
      {/* Session header - only show when session selected */}
      {session && (
        <div className="px-4 py-3 border-b border-bd-0 flex items-center gap-3">
          <Bot className="w-5 h-5 text-status-progress" />
          <div>
            <div className="font-mono text-sm text-fg-0">{session.agentId}</div>
            <div className="text-xs text-fg-3">
              {session.kind} · {session.model || 'default model'}
              {session.operationId && ` · op:${session.operationId.slice(0, 8)}`}
            </div>
          </div>

          {/* Context usage */}
          {session.percentUsed !== null && (
            <div className="ml-auto flex items-center gap-2">
              <div className="w-24 h-1.5 bg-bg-3 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full transition-all',
                    session.percentUsed > 80
                      ? 'bg-status-danger'
                      : session.percentUsed > 50
                        ? 'bg-status-warning'
                        : 'bg-status-success'
                  )}
                  style={{ width: `${session.percentUsed}%` }}
                />
              </div>
              <span className="text-xs text-fg-3">{session.percentUsed}%</span>
            </div>
          )}
        </div>
      )}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {noSession ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Terminal className="w-12 h-12 text-fg-3 mx-auto mb-3" />
              <p className="text-fg-2">Select a session to send messages</p>
              <p className="text-xs text-fg-3 mt-2 max-w-[220px]">
                Choose a session from the list on the left to start sending messages.
              </p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Terminal className="w-8 h-8 text-fg-3 mx-auto mb-2" />
              <p className="text-sm text-fg-2">No messages yet</p>
              <p className="text-xs text-fg-3 mt-1">
                Send a message to this session
              </p>
              <p className="text-[10px] text-fg-3/70 mt-2 max-w-[200px]">
                Messages are sent via WebSocket and injected into the session context.
              </p>
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
      </div>

      {/* Send form - always visible */}
      <SendForm
        onSend={onSend}
        disabled={inputDisabled}
        placeholder={getPlaceholder()}
      />
    </div>
  )
}
