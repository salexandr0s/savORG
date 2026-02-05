# WEBCLAW_INTEGRATION.md

## Goal
Integrate WebClaw's chat UI components and patterns into ClawControl's Console page, replacing the current basic chat with a polished, feature-rich chat experience.

## Source
- Repository: https://github.com/ibelick/webclaw
- Reference: Clone locally to `~/clawd/projects/webclaw-ref/` for component extraction

## Current State
- ClawControl has a basic Console page at `apps/clawcontrol/app/(dashboard)/console/`
- Current chat is functional but lacks polish (basic markdown, no syntax highlighting, simple auto-scroll)
- WebClaw has production-ready chat components we can adapt

## Tasks

### 0. Clone WebClaw for Reference
```bash
git clone https://github.com/ibelick/webclaw.git ~/clawd/projects/webclaw-ref
```

### 1. Install Required Dependencies
Add to `apps/clawcontrol/package.json`:
```json
{
  "dependencies": {
    "shiki": "^3.21.0",
    "react-markdown": "^10.1.0",
    "remark-gfm": "^4.0.1",
    "remark-breaks": "^4.0.0",
    "use-stick-to-bottom": "^1.1.2",
    "motion": "^12.29.2",
    "zustand": "^5.0.11"
  }
}
```
Run `npm install` from repo root.

### 2. Create Prompt-Kit Components Directory
Create `apps/clawcontrol/components/prompt-kit/` and adapt these files from WebClaw:

#### 2.1 Chat Container (`chat-container.tsx`)
Adapt from `webclaw/src/components/prompt-kit/chat-container.tsx`:
- Auto-scroll with `use-stick-to-bottom`
- Smooth scroll behavior
- Handles streaming messages
- Scroll-to-bottom button when scrolled up

#### 2.2 Message Component (`message.tsx`)
Adapt from `webclaw/src/components/prompt-kit/message.tsx`:
- User vs Assistant message styling
- Avatar support
- Timestamp display
- Copy button on hover
- Loading state with typing indicator

#### 2.3 Markdown Renderer (`markdown.tsx`)
Adapt from `webclaw/src/components/prompt-kit/markdown.tsx`:
- react-markdown with remark-gfm
- remark-breaks for line breaks
- Custom component mapping
- Link handling (open in new tab)
- Table styling

#### 2.4 Code Block (`code-block/`)
Adapt from `webclaw/src/components/prompt-kit/code-block/`:
- Shiki for syntax highlighting
- Copy button
- Language label
- Line numbers (optional)
- Dark theme matching our design system

#### 2.5 Prompt Input (`prompt-input.tsx`)
Create new or adapt:
- Auto-resize textarea
- Submit on Enter (Shift+Enter for newline)
- File attachment support (future)
- Clear button
- Character count (optional)

### 3. Create Chat Store with Zustand
Create `apps/clawcontrol/lib/stores/chat-store.ts`:
```typescript
import { create } from 'zustand'

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  isStreaming?: boolean
}

interface ChatState {
  messages: Message[]
  isConnected: boolean
  isLoading: boolean
  error: string | null
  
  // Actions
  addMessage: (message: Message) => void
  updateMessage: (id: string, content: string) => void
  setStreaming: (id: string, isStreaming: boolean) => void
  clearMessages: () => void
  setConnected: (connected: boolean) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isConnected: false,
  isLoading: false,
  error: null,
  
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  
  updateMessage: (id, content) => set((state) => ({
    messages: state.messages.map(m => 
      m.id === id ? { ...m, content } : m
    )
  })),
  
  setStreaming: (id, isStreaming) => set((state) => ({
    messages: state.messages.map(m =>
      m.id === id ? { ...m, isStreaming } : m
    )
  })),
  
  clearMessages: () => set({ messages: [] }),
  setConnected: (connected) => set({ isConnected: connected }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
}))
```

### 4. Create WebSocket Hook
Create `apps/clawcontrol/hooks/use-gateway-chat.ts`:
```typescript
import { useEffect, useRef, useCallback } from 'react'
import { useChatStore } from '@/lib/stores/chat-store'

interface UseGatewayChatOptions {
  url?: string  // Default: ws://127.0.0.1:18789
  token?: string
  agentId?: string
  sessionKey?: string
  autoConnect?: boolean
}

export function useGatewayChat(options: UseGatewayChatOptions = {}) {
  const ws = useRef<WebSocket | null>(null)
  const { 
    addMessage, 
    updateMessage, 
    setStreaming,
    setConnected, 
    setLoading,
    setError 
  } = useChatStore()
  
  const connect = useCallback(() => {
    // WebSocket connection to OpenClaw gateway
    // Handle authentication
    // Handle message streaming
    // Handle reconnection
  }, [options])
  
  const sendMessage = useCallback((content: string) => {
    // Send user message
    // Add to local state immediately
    // Handle streaming response
  }, [])
  
  const disconnect = useCallback(() => {
    ws.current?.close()
    setConnected(false)
  }, [])
  
  useEffect(() => {
    if (options.autoConnect) {
      connect()
    }
    return () => disconnect()
  }, [])
  
  return {
    sendMessage,
    connect,
    disconnect,
  }
}
```

### 5. Update Console Page
Rewrite `apps/clawcontrol/app/(dashboard)/console/console-client.tsx`:

```typescript
'use client'

import { ChatContainer } from '@/components/prompt-kit/chat-container'
import { Message } from '@/components/prompt-kit/message'
import { PromptInput } from '@/components/prompt-kit/prompt-input'
import { useChatStore } from '@/lib/stores/chat-store'
import { useGatewayChat } from '@/hooks/use-gateway-chat'

export function ConsoleClient() {
  const { messages, isConnected, isLoading } = useChatStore()
  const { sendMessage, connect } = useGatewayChat({
    autoConnect: true,
  })
  
  return (
    <div className="flex flex-col h-full">
      {/* Connection status bar */}
      <div className="...">
        {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
      </div>
      
      {/* Chat container with messages */}
      <ChatContainer className="flex-1">
        {messages.map((msg) => (
          <Message
            key={msg.id}
            role={msg.role}
            content={msg.content}
            timestamp={msg.timestamp}
            isStreaming={msg.isStreaming}
          />
        ))}
      </ChatContainer>
      
      {/* Input area */}
      <PromptInput
        onSubmit={sendMessage}
        disabled={!isConnected || isLoading}
        placeholder="Send a message..."
      />
    </div>
  )
}
```

### 6. Add Session Selector
Update the session list sidebar to:
- Show active sessions from OpenClaw
- Allow switching between sessions
- Show session metadata (agent, model, token usage)
- Add "New Session" button

### 7. Add Streaming Support
Implement proper SSE/WebSocket streaming:
- Show partial responses as they arrive
- Typing indicator during generation
- Cancel button to stop generation
- Handle tool calls display (collapsible sections)

### 8. Style Integration
Ensure all new components use ClawControl's design tokens:
- `bg-bg-*` for backgrounds
- `text-fg-*` for text colors
- `border-bd-*` for borders
- `rounded-[var(--radius-*)]` for border radius
- Match existing dark theme

### 9. Add Motion Animations
Using `motion` library:
- Message fade-in on appear
- Smooth scroll animations
- Button hover states
- Loading states

### 10. Features to Include

#### From WebClaw:
- [x] Auto-scroll with stick-to-bottom
- [x] Markdown rendering with GFM
- [x] Shiki code highlighting
- [x] Copy code button
- [x] Message timestamps
- [x] Streaming text display
- [x] Connection status indicator

#### ClawControl-specific:
- [ ] Agent selector (which agent to chat with)
- [ ] Session history sidebar
- [ ] Token usage display
- [ ] Model badge in messages
- [ ] Tool call visualization (expandable)
- [ ] File attachment preview
- [ ] Slash commands support

## File Structure After Integration
```
apps/clawcontrol/
├── components/
│   └── prompt-kit/
│       ├── index.ts
│       ├── chat-container.tsx
│       ├── message.tsx
│       ├── markdown.tsx
│       ├── prompt-input.tsx
│       └── code-block/
│           ├── index.tsx
│           ├── code-block.tsx
│           ├── copy-button.tsx
│           └── shiki-highlighter.ts
├── hooks/
│   └── use-gateway-chat.ts
├── lib/
│   └── stores/
│       └── chat-store.ts
└── app/(dashboard)/console/
    ├── page.tsx
    ├── console-client.tsx
    └── components/
        ├── session-list.tsx
        ├── session-item.tsx
        └── agent-selector.tsx
```

## Testing
1. Start ClawControl: `./start.sh --web`
2. Navigate to Console page
3. Verify WebSocket connection to gateway
4. Send a message, verify streaming response
5. Check markdown rendering (code blocks, tables, lists)
6. Test auto-scroll behavior
7. Test session switching
8. Verify styling matches design system

## Notes
- WebClaw uses Vite + TanStack Router; we use Next.js — adapt imports accordingly
- WebClaw connects directly to gateway WebSocket; we may proxy through our API
- Keep existing Console functionality (session list, etc.) — enhance, don't remove
- Shiki requires async loading; handle SSR appropriately in Next.js
