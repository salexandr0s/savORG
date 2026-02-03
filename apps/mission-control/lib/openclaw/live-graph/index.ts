/**
 * Gateway Live Graph Module
 *
 * Crabwalk-style live visualization of OpenClaw agent activity.
 * Server-side only - the browser never connects to the Gateway directly.
 */

// Types
export type {
  GatewayFrame,
  GatewayFrameEvent,
  GatewayFrameData,
  GatewayEventKind,
  GatewayEventSource,
  GatewayEvent,
  GatewayEventPayload,
  GraphNodeKind,
  GraphEdgeKind,
  EdgeConfidence,
  GraphNode,
  GraphNodeMetadata,
  GraphEdge,
  GraphSnapshot,
  GraphDelta,
  GraphUpdate,
  MirrorMode,
  MirrorStatus,
  MirrorConfig,
  ConnectRequest,
} from './types'

export {
  DEFAULT_CONFIG,
  SPAWN_INFERENCE_WINDOW_MS,
  SUBAGENT_PATTERN,
  OPERATION_ID_PATTERN,
  WORK_ORDER_ID_PATTERN,
} from './types'

// Redaction
export {
  redactFrameData,
  createSafePayload,
  isSafeField,
  redactString,
  looksLikeSensitive,
} from './redaction'

// Graph Store
export { LiveGraphStore } from './graph-store'
export type { LiveGraphStoreConfig } from './graph-store'

// Event Normalizer
export {
  normalizeFrame,
  eventToGraphUpdates,
  isSubagentEvent,
  createSpawnEdge,
} from './event-normalizer'

// Mirror Service
export { GatewayMirrorService, getMirrorService } from './mirror-service'
