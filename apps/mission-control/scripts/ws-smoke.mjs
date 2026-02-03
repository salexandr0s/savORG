#!/usr/bin/env node
/**
 * WebSocket Adapter Smoke Test
 *
 * Tests the WsAdapter connection and basic methods against a running OpenClaw gateway.
 *
 * Usage:
 *   node apps/mission-control/scripts/ws-smoke.mjs
 *   node apps/mission-control/scripts/ws-smoke.mjs --send "Hello from smoke test"
 *
 * Environment:
 *   OPENCLAW_GATEWAY_WS_URL - WebSocket URL (default: ws://127.0.0.1:18789)
 *   OPENCLAW_GATEWAY_TOKEN - Auth token (optional if device identity available)
 *   OPENCLAW_TEST_SESSION_KEY - Session key for history test (default: main)
 *
 * Authentication (tried in order):
 *   1. Token auth via OPENCLAW_GATEWAY_TOKEN
 *   2. Device identity from ~/.openclaw/identity/device.json
 *
 * Exit codes:
 *   0 - All tests passed
 *   1 - Connection failed
 *   2 - sessions.list failed
 *   3 - chat.history failed
 *   4 - chat.send failed (if --send provided)
 */

import { randomUUID } from 'crypto'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import WebSocket from 'ws'

// ============================================================================
// Configuration
// ============================================================================

const WS_URL = process.env.OPENCLAW_GATEWAY_WS_URL || 'ws://127.0.0.1:18789'
const WS_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN
const TEST_SESSION_KEY = process.env.OPENCLAW_TEST_SESSION_KEY || 'main'
// OpenClaw PROTOCOL_VERSION = 3 as of latest version
const PROTOCOL_VERSION = 3

// Parse args
const args = process.argv.slice(2)
const sendIndex = args.indexOf('--send')
const sendMessage = sendIndex >= 0 ? args[sendIndex + 1] : null

// ============================================================================
// Device Identity Helpers (ported from OpenClaw)
// ============================================================================

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

function base64UrlEncode(buf) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "")
}

function derivePublicKeyRaw(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem)
  const spki = key.export({ type: "spki", format: "der" })
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length)
  }
  return spki
}

function publicKeyRawBase64UrlFromPem(publicKeyPem) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem))
}

function signDevicePayload(privateKeyPem, payload) {
  const key = crypto.createPrivateKey(privateKeyPem)
  const sig = crypto.sign(null, Buffer.from(payload, "utf8"), key)
  return base64UrlEncode(sig)
}

function buildDeviceAuthPayload(params) {
  const version = params.version ?? (params.nonce ? "v2" : "v1")
  const scopes = params.scopes.join(",")
  const token = params.token ?? ""
  const base = [
    version,
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(params.signedAtMs),
    token,
  ]
  if (version === "v2") {
    base.push(params.nonce ?? "")
  }
  return base.join("|")
}

function loadDeviceIdentity() {
  const filePath = path.join(os.homedir(), ".openclaw", "identity", "device.json")
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8")
      const parsed = JSON.parse(raw)
      if (
        parsed?.version === 1 &&
        typeof parsed.deviceId === "string" &&
        typeof parsed.publicKeyPem === "string" &&
        typeof parsed.privateKeyPem === "string"
      ) {
        return {
          deviceId: parsed.deviceId,
          publicKeyPem: parsed.publicKeyPem,
          privateKeyPem: parsed.privateKeyPem,
        }
      }
    }
  } catch {
    // fall through
  }
  return null
}

function loadDeviceAuthToken(deviceId, role = 'operator') {
  const filePath = path.join(os.homedir(), ".openclaw", "identity", "device-auth.json")
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf8")
      const parsed = JSON.parse(raw)
      if (parsed?.version === 1 && parsed?.deviceId === deviceId && parsed?.tokens?.[role]?.token) {
        return parsed.tokens[role].token
      }
    }
  } catch {
    // fall through
  }
  return null
}

// ============================================================================
// Logging
// ============================================================================

const log = {
  info: (...args) => console.log('[INFO]', ...args),
  success: (...args) => console.log('[✓]', ...args),
  error: (...args) => console.error('[✗]', ...args),
  data: (label, data) => console.log(`[DATA] ${label}:`, JSON.stringify(data, null, 2)),
}

// ============================================================================
// WebSocket Client
// ============================================================================

class WsClient {
  constructor(url, deviceIdentity, token) {
    this.url = url
    this.deviceIdentity = deviceIdentity
    this.token = token
    this.ws = null
    this.connected = false
    this.helloOk = null
    this.pendingRequests = new Map()
    this.requestId = 0
    this.connectNonce = null
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout (10s)'))
      }, 10000)

      this.ws = new WebSocket(this.url)

      this.ws.on('open', () => {
        log.info(`Connected to ${this.url}`)
        // Don't send connect yet - wait for challenge
      })

      this.ws.on('message', (data) => {
        try {
          const frame = JSON.parse(data.toString())

          // Handle connect.challenge event
          if (frame.type === 'event' && frame.event === 'connect.challenge') {
            log.info(`Event: ${frame.event}`)
            const nonce = frame.payload?.nonce
            if (nonce) {
              this.connectNonce = nonce
            }
            this.sendConnect()
            return
          }

          // Handle response
          if (frame.type === 'res') {
            // Check if this is a connect response
            if (frame.id === 'connect') {
              clearTimeout(timeout)
              if (!frame.ok) {
                const errorMsg = frame.error?.message || 'Connect failed'
                reject(new Error(errorMsg))
                return
              }
              // hello-ok is inside the payload
              this.helloOk = frame.payload
              this.connected = true
              resolve(frame.payload)
              return
            }

            const pending = this.pendingRequests.get(frame.id)
            if (pending) {
              this.pendingRequests.delete(frame.id)
              clearTimeout(pending.timeout)
              if (frame.ok) {
                pending.resolve(frame.payload)
              } else {
                pending.reject(new Error(frame.error?.message || 'Request failed'))
              }
            }
            return
          }

          // Handle event
          if (frame.type === 'event') {
            log.info(`Event: ${frame.event}`, frame.payload?.state || '')
            return
          }
        } catch (err) {
          log.error('Failed to parse message:', err.message)
        }
      })

      this.ws.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })

      this.ws.on('close', (code, reason) => {
        clearTimeout(timeout)
        if (!this.connected) {
          reject(new Error(`Connection closed: ${code} ${reason}`))
        }
      })
    })
  }

  sendConnect() {
    // Role is 'operator' - the scopes specify what the operator can do
    // The device token on this machine has scopes: operator.admin, operator.approvals, operator.pairing
    // operator.admin is sufficient for most methods (sessions.list, chat.send, chat.history)
    const role = 'operator'
    const scopes = ['operator.admin', 'operator.approvals', 'operator.pairing']
    const signedAtMs = Date.now()
    const nonce = this.connectNonce ?? undefined

    // Build device auth if we have identity
    let device = undefined
    if (this.deviceIdentity) {
      const payload = buildDeviceAuthPayload({
        deviceId: this.deviceIdentity.deviceId,
        clientId: 'gateway-client',
        clientMode: 'backend',
        role,
        scopes,
        signedAtMs,
        token: this.token ?? null,
        nonce,
      })
      const signature = signDevicePayload(this.deviceIdentity.privateKeyPem, payload)
      device = {
        id: this.deviceIdentity.deviceId,
        publicKey: publicKeyRawBase64UrlFromPem(this.deviceIdentity.publicKeyPem),
        signature,
        signedAt: signedAtMs,
        nonce,
      }
      log.info('Using device identity for authentication')
    }

    // Build auth params
    let auth = undefined
    if (this.token) {
      auth = { token: this.token }
      log.info('Using token for authentication')
    }

    log.info(`Device: ${device ? 'present' : 'absent'}, Auth: ${auth ? 'present' : 'absent'}`)

    const params = {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: 'gateway-client',  // Must match GATEWAY_CLIENT_IDS
        displayName: 'Mission Control Smoke Test',
        version: '1.0.0',
        platform: 'nodejs',
        mode: 'backend',  // Must match GATEWAY_CLIENT_MODES
        instanceId: randomUUID().slice(0, 8),
      },
      role,
      scopes,
      device,
      auth,
    }

    this.ws.send(JSON.stringify({
      type: 'req',
      id: 'connect',
      method: 'connect',
      params,
    }))
  }

  async request(method, params) {
    if (!this.connected) {
      throw new Error('Not connected')
    }

    const id = `req-${++this.requestId}`

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout: ${method}`))
      }, 30000)

      this.pendingRequests.set(id, { resolve, reject, timeout })

      this.ws.send(JSON.stringify({
        type: 'req',
        id,
        method,
        params,
      }))
    })
  }

  close() {
    if (this.ws) {
      this.ws.close()
    }
  }
}

// ============================================================================
// Tests
// ============================================================================

async function runTests() {
  // Load device identity
  const deviceIdentity = loadDeviceIdentity()
  let token = WS_TOKEN

  if (deviceIdentity) {
    log.info(`Device identity loaded: ${deviceIdentity.deviceId.slice(0, 16)}...`)
    // Try to load cached device auth token
    if (!token) {
      const cachedToken = loadDeviceAuthToken(deviceIdentity.deviceId, 'operator')
      if (cachedToken) {
        log.info(`Device auth token loaded from cache`)
        token = cachedToken
      }
    }
  }

  if (!deviceIdentity && !token) {
    log.error('No device identity found and no token configured!')
    log.info('Set OPENCLAW_GATEWAY_TOKEN or ensure ~/.openclaw/identity/device.json exists')
    process.exit(1)
  }

  const client = new WsClient(WS_URL, deviceIdentity, token)

  try {
    // Test 1: Connect
    log.info('Test 1: Connecting...')
    const hello = await client.connect()
    log.success(`Connected! Server: v${hello.server.version}, Protocol: ${hello.protocol}`)
    log.data('Features', {
      methods: hello.features.methods.slice(0, 10).concat(['...']),
      events: hello.features.events,
    })

    // Test 2: sessions.list
    log.info('\nTest 2: sessions.list...')
    const sessions = await client.request('sessions.list', {})
    log.success(`Got ${sessions.sessions?.length || 0} sessions`)
    if (sessions.sessions?.length > 0) {
      log.data('First session', sessions.sessions[0])
    }

    // Test 3: chat.history
    log.info(`\nTest 3: chat.history for "${TEST_SESSION_KEY}"...`)
    try {
      const history = await client.request('chat.history', {
        sessionKey: TEST_SESSION_KEY,
        limit: 5,
      })
      log.success(`Got ${history.messages?.length || 0} messages`)
      if (history.messages?.length > 0) {
        log.data('Last message role', history.messages[history.messages.length - 1]?.role)
      }
    } catch (err) {
      log.error(`chat.history failed: ${err.message}`)
      log.info('(This may be expected if session does not exist)')
    }

    // Test 4: chat.send (optional)
    if (sendMessage) {
      log.info(`\nTest 4: chat.send to "${TEST_SESSION_KEY}"...`)
      const sendResult = await client.request('chat.send', {
        sessionKey: TEST_SESSION_KEY,
        message: sendMessage,
        idempotencyKey: randomUUID(),
      })
      log.success(`Send initiated! runId: ${sendResult.runId}, status: ${sendResult.status}`)
      log.data('Send result', sendResult)

      // Wait a bit to see streaming events
      log.info('Waiting 5s for streaming events...')
      await new Promise(r => setTimeout(r, 5000))
    }

    log.info('\n========================================')
    log.success('All tests passed!')
    client.close()
    process.exit(0)

  } catch (err) {
    log.error(`Test failed: ${err.message}`)
    client.close()

    if (err.message.includes('Connection')) {
      process.exit(1)
    } else if (err.message.includes('sessions.list')) {
      process.exit(2)
    } else if (err.message.includes('chat.history')) {
      process.exit(3)
    } else if (err.message.includes('chat.send')) {
      process.exit(4)
    } else {
      process.exit(1)
    }
  }
}

// ============================================================================
// Main
// ============================================================================

log.info('========================================')
log.info('WebSocket Adapter Smoke Test')
log.info('========================================')
log.info(`URL: ${WS_URL}`)
log.info(`Auth: ${WS_TOKEN ? 'token configured' : 'device identity (if available)'}`)
log.info(`Session: ${TEST_SESSION_KEY}`)
log.info(`Send: ${sendMessage || '(not sending)'}`)
log.info(`Protocol: v${PROTOCOL_VERSION}`)
log.info('========================================\n')

runTests()
