/**
 * Gateway Event Redaction
 *
 * Strips sensitive fields from gateway events before storage and emission.
 * This is a CRITICAL security boundary - tool args/results are NEVER exposed
 * to the UI unless explicitly requested through governor-gated API.
 */

import type { GatewayFrameData, GatewayEventPayload } from './types'

/**
 * Fields that are ALWAYS redacted from gateway frames.
 * These contain potentially sensitive information (tool args, results, etc.)
 */
const REDACTED_FIELDS = new Set([
  'args',
  'result',
  'input',
  'output',
  'body',
  'payload',
  'content',      // Redact full content - only keep structured metadata
  'text',
  'message',
  'prompt',
  'completion',
  'response',
  'data',         // Generic data field often contains secrets
  'env',
  'environment',
  'secret',
  'token',
  'key',
  'password',
  'credential',
  'authorization',
  'bearer',
  'api_key',
  'apiKey',
])

/**
 * Fields that are safe to preserve from gateway frames.
 * This is a whitelist approach - only explicitly safe fields are kept.
 */
const SAFE_FIELDS = new Set([
  'sessionKey',
  'sessionId',
  'agentId',
  'stream',
  'type',
  'phase',
  'tool',
  'toolName',
  'channel',
  'messageId',
  'exitCode',
  'durationMs',
  'startedAt',
  'endedAt',
  'status',
  'state',
])

/**
 * Redact a raw gateway frame data object.
 * Returns a new object with only safe fields preserved.
 */
export function redactFrameData(data: GatewayFrameData | undefined): GatewayFrameData | undefined {
  if (!data) return undefined

  const redacted: GatewayFrameData = {}

  for (const [key, value] of Object.entries(data)) {
    // Skip explicitly redacted fields
    if (REDACTED_FIELDS.has(key.toLowerCase())) {
      continue
    }

    // Only keep explicitly safe fields
    if (SAFE_FIELDS.has(key)) {
      redacted[key] = value
    }
    // Skip unknown fields for safety
  }

  return redacted
}

/**
 * Create a safe payload for a normalized GatewayEvent.
 * Extracts only the safe fields needed for the UI.
 */
export function createSafePayload(
  data: GatewayFrameData | undefined,
  sessionKey: string
): GatewayEventPayload {
  const payload: GatewayEventPayload = {}

  // Parse operation ID from sessionKey
  const opMatch = sessionKey.match(/(?:^|:)op:([a-z0-9]{10,})/i)
  if (opMatch) {
    payload.operationId = opMatch[1]
  }

  // Parse work order ID from sessionKey
  const woMatch = sessionKey.match(/(?:^|:)wo:([a-z0-9]{10,})/i)
  if (woMatch) {
    payload.workOrderId = woMatch[1]
  }

  // Detect subagent
  if (/subagent/i.test(sessionKey)) {
    payload.isSubagent = true
  }

  if (!data) return payload

  // Tool name (safe)
  if (data.tool) {
    payload.toolName = String(data.tool)
  } else if (data.toolName) {
    payload.toolName = String(data.toolName)
  }

  // Duration (safe)
  if (typeof data.durationMs === 'number') {
    payload.durationMs = data.durationMs
  }

  // Exit code (safe)
  if (typeof data.exitCode === 'number') {
    payload.exitCode = data.exitCode
  }

  // Channel (safe - only if explicitly present)
  if (data.channel && typeof data.channel === 'string') {
    payload.channel = data.channel
  }

  // Message ID (safe)
  if (data.messageId && typeof data.messageId === 'string') {
    payload.messageId = data.messageId
  }

  // Tool status based on event type
  if (data.type === 'tool_use') {
    payload.toolStatus = 'started'
  } else if (data.type === 'tool_result') {
    payload.toolStatus = data.exitCode === 0 || data.exitCode === undefined ? 'completed' : 'failed'
  }

  return payload
}

/**
 * Check if a field name is safe to include in UI.
 */
export function isSafeField(fieldName: string): boolean {
  return SAFE_FIELDS.has(fieldName) && !REDACTED_FIELDS.has(fieldName.toLowerCase())
}

/**
 * Redact a string that might contain sensitive data.
 * Used for logging and error messages.
 */
export function redactString(str: string, maxLength = 100): string {
  if (str.length <= maxLength) {
    return str
  }
  return str.slice(0, maxLength) + '... [redacted]'
}

/**
 * Check if a value looks like it might be sensitive.
 * Used as an additional safety check.
 */
export function looksLikeSensitive(value: unknown): boolean {
  if (typeof value !== 'string') return false

  const sensitivePatterns = [
    /^sk-[a-zA-Z0-9]+$/,     // API key format
    /^ghp_[a-zA-Z0-9]+$/,    // GitHub token
    /^xox[baprs]-/,          // Slack token
    /^[A-Za-z0-9-_]{20,}$/,  // Long alphanumeric (potential token)
    /password/i,
    /secret/i,
    /token/i,
    /api.?key/i,
  ]

  return sensitivePatterns.some(pattern => pattern.test(value))
}
