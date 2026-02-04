'use client'

import { cn } from '@/lib/utils'
import { Filter, Bot, MessageSquare, Wrench, Settings, Radio } from 'lucide-react'
import type { useGatewayGraphStore } from '../graph-store'
import type { GraphNodeKind } from '@/lib/openclaw/live-graph'

const NODE_KIND_CONFIG: Record<GraphNodeKind, { label: string; icon: typeof Bot; color: string }> = {
  chat: { label: 'Chat', icon: MessageSquare, color: 'text-status-info' },
  session: { label: 'Session', icon: Bot, color: 'text-status-success' },
  turn: { label: 'Turn', icon: Radio, color: 'text-fg-2' },
  tool_call: { label: 'Tool', icon: Wrench, color: 'text-status-warning' },
  assistant: { label: 'Assistant', icon: Settings, color: 'text-status-progress' },
}

interface GraphHeaderProps {
  store: ReturnType<typeof useGatewayGraphStore>
}

export function GraphHeader({ store }: GraphHeaderProps) {
  const { state, actions, uniqueAgentIds } = store

  const toggleNodeKind = (kind: GraphNodeKind) => {
    const newKinds = new Set(state.filters.nodeKinds)
    if (newKinds.has(kind)) {
      newKinds.delete(kind)
    } else {
      newKinds.add(kind)
    }
    actions.setFilter({ nodeKinds: newKinds })
  }

  const setSessionKeyPattern = (pattern: string) => {
    actions.setFilter({ sessionKeyPattern: pattern || null })
  }

  return (
    <div className="bg-bg-2 border-b border-bd-0 px-4 py-2">
      <div className="flex items-center gap-4 flex-wrap">
        {/* Node Kind Filters */}
        <div className="flex items-center gap-1">
          <Filter className="w-3.5 h-3.5 text-fg-3 mr-1" />
          {(Object.entries(NODE_KIND_CONFIG) as [GraphNodeKind, typeof NODE_KIND_CONFIG[GraphNodeKind]][]).map(
            ([kind, config]) => {
              const Icon = config.icon
              const isActive = state.filters.nodeKinds.has(kind)
              return (
                <button
                  key={kind}
                  onClick={() => toggleNodeKind(kind)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-[var(--radius-sm)] transition-colors',
                    isActive
                      ? 'bg-bg-3 text-fg-0 border border-bd-1'
                      : 'text-fg-3 hover:text-fg-2 hover:bg-bg-3/50'
                  )}
                >
                  <Icon className={cn('w-3 h-3', isActive && config.color)} />
                  {config.label}
                </button>
              )
            }
          )}
        </div>

        {/* Agent Filter */}
        {uniqueAgentIds.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-fg-3">Agent:</span>
            <select
              value={state.filters.agentIds.size === 1 ? Array.from(state.filters.agentIds)[0] : ''}
              onChange={(e) => {
                if (e.target.value) {
                  actions.setFilter({ agentIds: new Set([e.target.value]) })
                } else {
                  actions.setFilter({ agentIds: new Set() })
                }
              }}
              className="px-2 py-1 text-xs font-medium rounded-[var(--radius-sm)] bg-bg-3 text-fg-1 border border-bd-0 focus:outline-none focus:border-bd-1"
            >
              <option value="">All agents</option>
              {uniqueAgentIds.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Session Key Pattern */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-3">SessionKey:</span>
          <input
            type="text"
            value={state.filters.sessionKeyPattern || ''}
            onChange={(e) => setSessionKeyPattern(e.target.value)}
            placeholder=":op: or :wo:"
            className="px-2 py-1 text-xs font-mono rounded-[var(--radius-sm)] bg-bg-3 text-fg-1 border border-bd-0 focus:outline-none focus:border-bd-1 w-32"
          />
        </div>

        {/* Active Only Toggle */}
        <button
          onClick={() => actions.setFilter({ activeOnly: !state.filters.activeOnly })}
          className={cn(
            'flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-[var(--radius-sm)] transition-colors',
            state.filters.activeOnly
              ? 'bg-status-progress/10 text-status-progress border border-status-progress/30'
              : 'text-fg-3 hover:text-fg-2 hover:bg-bg-3/50'
          )}
        >
          Active only
        </button>
      </div>
    </div>
  )
}
