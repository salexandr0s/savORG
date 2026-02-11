import { getGatewayProbe, type GatewayProbeDTO, type GatewayStatusDTO } from '@/lib/data'
import { MaintenanceClient } from './maintenance-client'
import { AvailabilityBadge } from '@/components/availability-badge'
import { listPlaybooks } from '@/lib/fs/playbooks-fs'

/**
 * Map OpenClaw gateway probe response to the UI's GatewayStatusDTO format.
 */
function mapToUiDto(
  data: GatewayProbeDTO | null,
  status: 'ok' | 'degraded' | 'unavailable',
  latencyMs: number,
  timestamp: string
): GatewayStatusDTO {
  const reachable = data?.reachable ?? status !== 'unavailable'
  const uiStatus = status === 'unavailable' ? 'down' : status

  return {
    status: reachable ? uiStatus : 'down',
    lastCheckAt: new Date(timestamp),
    latencyMs: data?.latencyMs ?? latencyMs,
    version: 'unknown',
    uptime: 0,
    connections: {
      openClaw: reachable ? 'connected' : 'disconnected',
      database: reachable ? 'connected' : 'disconnected',
      redis: reachable ? 'connected' : 'disconnected',
    },
  }
}

export default async function MaintenancePage() {
  const [response, playbooks] = await Promise.all([
    getGatewayProbe(),
    listPlaybooks(),
  ])
  const gateway = mapToUiDto(response.data, response.status, response.latencyMs, response.timestamp)

  return (
    <div>
      <div className="mb-4">
        <AvailabilityBadge
          status={response.status}
          latencyMs={response.latencyMs}
          cached={response.cached}
          staleAgeMs={response.staleAgeMs}
          label="Gateway"
        />
      </div>

      {response.status === 'unavailable' ? (
        <div className="p-4 bg-status-error/10 rounded-md text-status-error mb-4">
          <p className="font-medium">OpenClaw Unavailable</p>
          <p className="text-sm mt-1">{response.error ?? 'Unable to connect to gateway'}</p>
        </div>
      ) : null}

      <MaintenanceClient gateway={gateway} playbooks={playbooks} />
    </div>
  )
}
