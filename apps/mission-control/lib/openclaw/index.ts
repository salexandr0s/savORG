/**
 * OpenClaw Integration
 *
 * Re-exports OpenClaw capabilities and utilities.
 */

export {
  getOpenClawCapabilities,
  hasPluginCapability,
  isPluginManagementAvailable,
  getUnavailablePluginActions,
  clearCapabilitiesCache,
  setCapabilitiesCacheTtl,
  type OpenClawCapabilities,
  type PluginCapabilities,
  type SourceCapabilities,
} from './capabilities'

export {
  spawnAgentSession,
  sendToSession,
  syncAgentSessions,
  type SpawnOptions,
  type SpawnResult,
} from './sessions'
