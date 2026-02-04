import { GatewayLiveClient } from './gateway-live-client'

/**
 * Gateway Live Graph Page
 *
 * Crabwalk-style visualization of real-time OpenClaw agent activity.
 * Shows sessions, turns, tool calls, subagent spawns, and message deliveries.
 */
export default function GatewayLivePage() {
  return <GatewayLiveClient />
}
