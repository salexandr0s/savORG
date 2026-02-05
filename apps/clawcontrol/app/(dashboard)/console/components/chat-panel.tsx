'use client'

import { Terminal, Bot, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StationIcon } from '@/components/station-icon'
import { ChatContainer, Message, PromptInput } from '@/components/prompt-kit'
import { SessionActivity } from './session-activity'
import type { ConsoleSessionDTO } from '@/app/api/openclaw/console/sessions/route'
import type { ChatMessage } from '@/lib/stores/chat-store'
import type { AgentDTO } from '@/lib/repo'

// ============================================================================
// TYPES
// ============================================================================

interface ChatPanelProps {
  session: ConsoleSessionDTO | null
  messages: ChatMessage[]
  onSend: (content: string) => void
  streaming: boolean
  runId: string | null
  onAbort: () => void
  sendDisabled: boolean
  agentsBySessionKey: Record<string, AgentDTO>
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ChatPanel({
  session,
  messages,
  onSend,
  streaming,
  runId,
  onAbort,
  sendDisabled,
  agentsBySessionKey,
}: ChatPanelProps) {
  const headerAgent = session ? agentsBySessionKey[session.sessionKey] : undefined
  const headerName = session ? (headerAgent?.name || session.agentId) : ''

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
    <div className="flex-1 flex flex-col bg-bg-0 min-w-0">
      {/* Session header - only show when session selected */}
      {session && (
        <div className="px-4 py-3 border-b border-bd-0 flex items-center gap-3">
          {headerAgent ? (
            <StationIcon stationId={headerAgent.station} size="md" className="w-5 h-5" />
          ) : (
            <Bot className="w-5 h-5 text-status-progress" />
          )}
          <div>
            <div className="font-mono text-sm text-fg-0">{headerName}</div>
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

          {/* Cancel */}
          {streaming && (
            <button
              type="button"
              onClick={onAbort}
              className={cn(
                'ml-3 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium',
                'rounded-[var(--radius-md)] border',
                'border-status-danger/40 text-status-danger hover:bg-status-danger/10'
              )}
              title={runId ? `Abort run ${runId}` : 'Abort'}
            >
              <XCircle className="w-4 h-4" />
              Cancel
            </button>
          )}
        </div>
      )}

      {/* Tools panel (redacted) */}
      {session && (
        <div className="border-b border-bd-0">
          <SessionActivity sessionKey={session.sessionKey} />
        </div>
      )}

      {/* Messages area */}
      <ChatContainer className="flex-1 min-h-0">
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
          messages.map((message) => {
            return (
              <Message
                key={message.id}
                role={message.role}
                content={message.content}
                timestamp={message.timestamp}
                pending={message.pending}
                streaming={message.streaming}
                error={message.error}
              />
            )
          })
        )}
      </ChatContainer>

      {/* Send form - always visible */}
      <PromptInput
        onSubmit={onSend}
        disabled={inputDisabled}
        placeholder={getPlaceholder()}
      />
    </div>
  )
}
