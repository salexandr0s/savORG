/**
 * OpenClaw Console Client
 *
 * Server-side only client for operator chat functionality.
 * Supports both HTTP (agent-scoped) and WebSocket (session-scoped) modes.
 * Enforces loopback-only unless explicitly overridden.
 *
 * Security:
 * - Gateway token never exposed to client
 * - All calls happen server-side
 * - Loopback-only by default (127.0.0.1, localhost, ::1)
 *
 * Modes:
 * - HTTP: Uses /v1/chat/completions, routes by agentId (not session-scoped)
 * - WS: Uses chat.send WS method, routes by sessionKey (true session messaging)
 */

import 'server-only'
import {
  createAdapter,
  createWsAdapter,
  WsAdapter,
  type OpenClawAdapter,
  type ChatSendParams,
  type ChatSendResult,
  type ChatHistoryParams,
  type ChatHistoryResult,
  type ChatInjectParams,
  type ChatInjectResult,
  type ChatAbortParams,
  type ChatAbortResult,
  type ChatEvent,
} from '@savorg/adapters-openclaw'

// ============================================================================
// CONSTANTS
// ============================================================================

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

const DEFAULT_HTTP_URL = 'http://127.0.0.1:18789'
const DEFAULT_WS_URL = 'ws://127.0.0.1:18789'

// ============================================================================
// TYPES
// ============================================================================

export interface ConsoleClientConfig {
  httpBaseUrl?: string
  httpToken?: string
  wsUrl?: string
  wsToken?: string
}

export interface GatewayAvailability {
  available: boolean
  latencyMs: number
  error?: string
}

// Re-export types for consumers
export type {
  ChatSendParams,
  ChatSendResult,
  ChatHistoryParams,
  ChatHistoryResult,
  ChatInjectParams,
  ChatInjectResult,
  ChatAbortParams,
  ChatAbortResult,
  ChatEvent,
}

// ============================================================================
// HTTP CLIENT FACTORY (Agent-scoped, existing behavior)
// ============================================================================

/**
 * Create an HTTP console client for gateway communication.
 * Uses /v1/chat/completions - routes by agentId, NOT session-scoped.
 * Enforces loopback-only unless OPENCLAW_ALLOW_NON_LOOPBACK=true.
 */
export function createConsoleClient(config?: ConsoleClientConfig): OpenClawAdapter {
  const baseUrl = config?.httpBaseUrl
    ?? process.env.OPENCLAW_GATEWAY_HTTP_URL
    ?? DEFAULT_HTTP_URL

  const token = config?.httpToken ?? process.env.OPENCLAW_GATEWAY_TOKEN

  // Security: enforce loopback unless explicitly overridden
  if (!process.env.OPENCLAW_ALLOW_NON_LOOPBACK) {
    const url = new URL(baseUrl)
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error(
        `Console client requires loopback address. Got: ${url.hostname}. ` +
        'Set OPENCLAW_ALLOW_NON_LOOPBACK=true to override (not recommended).'
      )
    }
  }

  return createAdapter({
    mode: 'remote_http',
    httpBaseUrl: baseUrl,
    httpToken: token,
  })
}

// ============================================================================
// WS CLIENT FACTORY (Session-scoped, true session messaging)
// ============================================================================

/**
 * Create a WebSocket console client for session-scoped messaging.
 * Uses chat.send WS method - routes by sessionKey for TRUE session injection.
 * Enforces loopback-only unless OPENCLAW_ALLOW_NON_LOOPBACK=true.
 */
export function createWsConsoleClient(config?: ConsoleClientConfig): WsAdapter {
  const wsUrl = config?.wsUrl
    ?? process.env.OPENCLAW_GATEWAY_WS_URL
    ?? DEFAULT_WS_URL

  const token = config?.wsToken ?? process.env.OPENCLAW_GATEWAY_TOKEN

  // Security: enforce loopback unless explicitly overridden
  if (!process.env.OPENCLAW_ALLOW_NON_LOOPBACK) {
    const url = new URL(wsUrl)
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw new Error(
        `Console WS client requires loopback address. Got: ${url.hostname}. ` +
        'Set OPENCLAW_ALLOW_NON_LOOPBACK=true to override (not recommended).'
      )
    }
  }

  return createWsAdapter({
    wsUrl,
    wsToken: token,
    wsClientId: 'openclaw-control-ui',  // Use valid gateway client ID
    wsClientMode: 'ui',                  // Use valid gateway client mode
    wsReadonly: false,                   // Enable write operations
  })
}

// ============================================================================
// SINGLETONS
// ============================================================================

let _httpClient: OpenClawAdapter | null = null
let _wsClient: WsAdapter | null = null

/**
 * Get the singleton HTTP console client (agent-scoped).
 * Creates on first call, reuses thereafter.
 */
export function getConsoleClient(): OpenClawAdapter {
  if (!_httpClient) {
    _httpClient = createConsoleClient()
  }
  return _httpClient
}

/**
 * Get the singleton WebSocket console client (session-scoped).
 * Creates on first call, reuses thereafter.
 */
export function getWsConsoleClient(): WsAdapter {
  if (!_wsClient) {
    _wsClient = createWsConsoleClient()
  }
  return _wsClient
}

/**
 * Reset all singleton clients (for testing).
 */
export function resetConsoleClient(): void {
  _httpClient = null
  if (_wsClient) {
    _wsClient.disconnect().catch(() => {})
    _wsClient = null
  }
}

// ============================================================================
// AVAILABILITY CHECK
// ============================================================================

/**
 * Check if the gateway is available.
 * Returns availability status with latency.
 */
export async function checkGatewayAvailability(): Promise<GatewayAvailability> {
  const start = Date.now()

  try {
    const client = getConsoleClient()
    const probe = await client.gatewayProbe()

    return {
      available: probe.ok,
      latencyMs: probe.latencyMs,
      error: probe.ok ? undefined : 'Gateway probe failed',
    }
  } catch (err) {
    return {
      available: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ============================================================================
// SEND MESSAGE HELPERS
// ============================================================================

/**
 * Send a message to an agent (HTTP mode, agent-scoped).
 * For streaming, use getConsoleClient().sendToAgent() directly.
 *
 * NOTE: This routes by agentId, NOT sessionKey. It does NOT inject
 * into an existing session's context.
 */
export async function sendMessageToAgent(
  agentId: string,
  message: string
): Promise<{ response: string; error?: string }> {
  try {
    const client = getConsoleClient()
    let response = ''

    for await (const chunk of client.sendToAgent(agentId, message)) {
      response += chunk
    }

    return { response }
  } catch (err) {
    return {
      response: '',
      error: err instanceof Error ? err.message : 'Failed to send message',
    }
  }
}

/**
 * Send a message to a session (WS mode, session-scoped).
 * This is TRUE session messaging - routes by sessionKey and injects
 * into the existing session's context.
 *
 * Returns the runId for streaming event subscription.
 */
export async function sendMessageToSession(
  sessionKey: string,
  message: string,
  idempotencyKey: string
): Promise<ChatSendResult> {
  const client = getWsConsoleClient()
  return client.chatSend({
    sessionKey,
    message,
    idempotencyKey,
  })
}

/**
 * Get chat history for a session.
 */
export async function getSessionHistory(
  sessionKey: string,
  limit?: number
): Promise<ChatHistoryResult> {
  const client = getWsConsoleClient()
  return client.chatHistory({ sessionKey, limit })
}

/**
 * Inject an assistant message into a session's transcript.
 * This does NOT trigger an agent response.
 */
export async function injectMessageToSession(
  sessionKey: string,
  message: string,
  label?: string
): Promise<ChatInjectResult> {
  const client = getWsConsoleClient()
  return client.chatInject({ sessionKey, message, label })
}

/**
 * Abort running chat for a session.
 */
export async function abortSessionChat(
  sessionKey: string,
  runId?: string
): Promise<ChatAbortResult> {
  const client = getWsConsoleClient()
  return client.chatAbort({ sessionKey, runId })
}

/**
 * Subscribe to chat events for a session.
 * Returns an unsubscribe function.
 */
export function subscribeToSessionEvents(
  sessionKey: string,
  callback: (event: ChatEvent) => void
): () => void {
  const client = getWsConsoleClient()
  return client.streamChatEvents(sessionKey, callback)
}
