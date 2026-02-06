/**
 * OpenClaw Config Sync Service
 *
 * Syncs agent model configuration changes to the local OpenClaw config file.
 */

import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { extractAgentIdFromSessionKey } from '@/lib/agent-identity'

const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json')

interface OpenClawAgent {
  id: string
  name?: string
  model?: {
    primary?: string
    fallbacks?: string[]
  }
  [key: string]: unknown
}

interface OpenClawConfig {
  agents?: {
    list?: OpenClawAgent[]
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface SyncResult {
  ok: boolean
  error?: string
  restartNeeded?: boolean
}

/**
 * Extract agent ID from session key
 * e.g., "agent:build-worker:main" -> "build-worker"
 */

/**
 * Sync an agent's model configuration to OpenClaw config file
 */
export async function syncAgentModelToOpenClaw(
  sessionKey: string,
  model: string | null | undefined,
  fallbacks: string[] | null | undefined
): Promise<SyncResult> {
  try {
    // Extract agent ID from session key
    const agentId = extractAgentIdFromSessionKey(sessionKey)
    if (!agentId) {
      return { ok: false, error: `Invalid session key format: ${sessionKey}` }
    }

    // Read current config
    let raw: string
    try {
      raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf-8')
    } catch (err) {
      return { ok: false, error: `Cannot read OpenClaw config: ${err}` }
    }

    let config: OpenClawConfig
    try {
      config = JSON.parse(raw)
    } catch (err) {
      return { ok: false, error: `Invalid JSON in OpenClaw config: ${err}` }
    }

    // Find agent in list
    const agentList = config.agents?.list
    if (!Array.isArray(agentList)) {
      return { ok: false, error: 'No agents.list array in OpenClaw config' }
    }

    const agentIndex = agentList.findIndex(
      (a) => a.id === agentId || a.name?.toLowerCase() === agentId.toLowerCase()
    )

    if (agentIndex === -1) {
      return { ok: false, error: `Agent "${agentId}" not found in OpenClaw config` }
    }

    // Update model config
    const agent = agentList[agentIndex]
    
    // Only update if we have values to set
    if (model !== undefined || fallbacks !== undefined) {
      agent.model = {
        ...agent.model,
        ...(model !== undefined && model !== null ? { primary: model } : {}),
        ...(fallbacks !== undefined && fallbacks !== null && fallbacks.length > 0 
          ? { fallbacks } 
          : {}),
      }

      // Remove fallbacks if empty array
      if (agent.model.fallbacks && agent.model.fallbacks.length === 0) {
        delete agent.model.fallbacks
      }

      // Write back
      await writeFile(OPENCLAW_CONFIG_PATH, JSON.stringify(config, null, 2))

      console.log(`[openclaw-config] Synced agent "${agentId}" model config`)
      
      return { ok: true, restartNeeded: true }
    }

    return { ok: true, restartNeeded: false }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/**
 * Read current model config for an agent from OpenClaw
 */
export async function getAgentModelFromOpenClaw(
  sessionKey: string
): Promise<{ model?: string; fallbacks?: string[] } | null> {
  try {
    const agentId = extractAgentIdFromSessionKey(sessionKey)
    if (!agentId) return null

    const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf-8')
    const config: OpenClawConfig = JSON.parse(raw)

    const agent = config.agents?.list?.find(
      (a) => a.id === agentId || a.name?.toLowerCase() === agentId.toLowerCase()
    )

    if (!agent) return null

    return {
      model: agent.model?.primary,
      fallbacks: agent.model?.fallbacks,
    }
  } catch {
    return null
  }
}
