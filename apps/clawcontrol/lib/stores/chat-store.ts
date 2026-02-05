import { create } from 'zustand'

export type ChatRole = 'operator' | 'agent' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  timestamp: Date
  pending?: boolean
  streaming?: boolean
  error?: string
}

export interface ChatState {
  messages: ChatMessage[]
  isLoading: boolean
  isStreaming: boolean
  error: string | null
  currentRunId: string | null

  setMessages: (messages: ChatMessage[]) => void
  addMessage: (message: ChatMessage) => void
  patchMessage: (id: string, patch: Partial<ChatMessage>) => void
  clearMessages: () => void

  setLoading: (loading: boolean) => void
  setStreaming: (streaming: boolean) => void
  setError: (error: string | null) => void
  setRunId: (runId: string | null) => void
  resetChat: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isLoading: false,
  isStreaming: false,
  error: null,
  currentRunId: null,

  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  patchMessage: (id, patch) =>
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    })),
  clearMessages: () => set({ messages: [] }),

  setLoading: (loading) => set({ isLoading: loading }),
  setStreaming: (streaming) => set({ isStreaming: streaming }),
  setError: (error) => set({ error }),
  setRunId: (runId) => set({ currentRunId: runId }),

  resetChat: () =>
    set({
      messages: [],
      isLoading: false,
      isStreaming: false,
      error: null,
      currentRunId: null,
    }),
}))

