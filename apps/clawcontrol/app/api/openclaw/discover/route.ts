import { NextResponse } from 'next/server'
import { probeGatewayHealth } from '@clawcontrol/adapters-openclaw'
import { getOpenClawConfig } from '@/lib/openclaw-client'

export async function GET() {
  const config = await getOpenClawConfig(true)

  if (!config) {
    return NextResponse.json(
      {
        status: 'not_found',
        message: 'OpenClaw config not found in ~/.openclaw (or ~/.OpenClaw), ~/.moltbot, or ~/.clawdbot (openclaw.json/moltbot.json/clawdbot.json/config.yaml)',
      },
      { status: 404 }
    )
  }

  const probe = await probeGatewayHealth(config.gatewayUrl, config.token ?? undefined)

  return NextResponse.json({
    status: probe.ok ? 'connected' : probe.state === 'auth_required' ? 'auth_required' : 'offline',
    gatewayUrl: config.gatewayUrl,
    gatewayWsUrl: config.gatewayWsUrl ?? null,
    hasToken: !!config.token,
    agentCount: config.agents.length,
    workspacePath: config.workspacePath ?? null,
    configPath: config.configPath,
    configPaths: config.configPaths,
    source: config.source,
    probe,
    agents: config.agents.map((a) => ({
      id: a.id,
      identity: a.identity ?? a.id,
    })),
  })
}
