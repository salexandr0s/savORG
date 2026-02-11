import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readSettings: vi.fn(),
  getOpenClawConfig: vi.fn(),
}))

vi.mock('@/lib/settings/store', () => ({
  readSettings: mocks.readSettings,
}))

vi.mock('@/lib/openclaw-client', () => ({
  getOpenClawConfig: mocks.getOpenClawConfig,
}))

function commandResult(overrides: Partial<{
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  notFound: boolean
  error: string
}> = {}) {
  return {
    ok: true,
    code: 0,
    stdout: '',
    stderr: '',
    notFound: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetModules()
  mocks.readSettings.mockReset()
  mocks.getOpenClawConfig.mockReset()

  mocks.readSettings.mockResolvedValue({
    settings: {
      remoteAccessMode: 'tailscale_tunnel',
      gatewayHttpUrl: 'http://127.0.0.1:18789',
      updatedAt: '2026-02-11T00:00:00.000Z',
    },
  })

  mocks.getOpenClawConfig.mockResolvedValue({
    gatewayUrl: 'http://127.0.0.1:18789',
  })
})

describe('tailscale readiness service', () => {
  it('reports ready state when loopback and tailnet checks pass', async () => {
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      const key = `${command} ${args.join(' ')}`
      if (key === 'lsof -nP -iTCP:3000 -sTCP:LISTEN') {
        return commandResult({
          stdout: 'node 1 me 1u IPv4 0 0t0 TCP 127.0.0.1:3000 (LISTEN)\n',
        })
      }
      if (key === 'lsof -nP -iTCP:18789 -sTCP:LISTEN') {
        return commandResult({
          stdout: 'node 2 me 2u IPv6 0 0t0 TCP [::1]:18789 (LISTEN)\n',
        })
      }
      if (key === 'tailscale version') {
        return commandResult({
          stdout: '1.84.0\ntailscale commit\n',
        })
      }
      if (key === 'tailscale status --json') {
        return commandResult({
          stdout: JSON.stringify({
            BackendState: 'Running',
            Self: { Online: true, DNSName: 'host.tailnet.ts.net.' },
            Peer: { p1: {}, p2: {} },
          }),
        })
      }
      if (key === 'tailscale serve status --json') {
        return commandResult({
          stdout: JSON.stringify({ TCP: {} }),
        })
      }
      if (key === 'ssh -V') {
        return commandResult({
          stderr: 'OpenSSH_10.0p2, LibreSSL 3.3.6',
        })
      }
      return commandResult()
    })

    const mod = await import('@/lib/system/tailscale-readiness')
    const report = await mod.getTailscaleReadinessReport({
      runCommand,
      getHostname: () => 'fallback-host',
    })

    expect(report.summary.state).toBe('ok')
    expect(report.commands.clawcontrolTunnel).toContain('host.tailnet.ts.net')
    expect(report.checks.find((check) => check.id === 'tailscale_status')?.state).toBe('ok')
    expect(report.checks.find((check) => check.id === 'tailscale_serve')?.state).toBe('ok')
  })

  it('flags forbidden exposure and non-loopback listener', async () => {
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      const key = `${command} ${args.join(' ')}`
      if (key === 'lsof -nP -iTCP:3000 -sTCP:LISTEN') {
        return commandResult({
          stdout: 'node 1 me 1u IPv4 0 0t0 TCP 0.0.0.0:3000 (LISTEN)\n',
        })
      }
      if (key === 'lsof -nP -iTCP:18789 -sTCP:LISTEN') {
        return commandResult({
          stdout: 'node 2 me 2u IPv4 0 0t0 TCP 127.0.0.1:18789 (LISTEN)\n',
        })
      }
      if (key === 'tailscale version') {
        return commandResult({ stdout: '1.84.0\n' })
      }
      if (key === 'tailscale status --json') {
        return commandResult({
          stdout: JSON.stringify({
            BackendState: 'Running',
            Self: { Online: true, HostName: 'devbox' },
            Peer: {},
          }),
        })
      }
      if (key === 'tailscale serve status --json') {
        return commandResult({
          stdout: JSON.stringify({
            TCP: { '3000': { HTTPS: true } },
          }),
        })
      }
      if (key === 'ssh -V') {
        return commandResult({
          stderr: 'OpenSSH_10.0p2',
        })
      }
      return commandResult()
    })

    const mod = await import('@/lib/system/tailscale-readiness')
    const report = await mod.getTailscaleReadinessReport({
      runCommand,
      getHostname: () => 'fallback-host',
    })

    expect(report.summary.state).toBe('error')
    expect(report.checks.find((check) => check.id === 'listener_3000')?.state).toBe('error')
    expect(report.checks.find((check) => check.id === 'tailscale_serve')?.state).toBe('error')
  })

  it('reports warnings when tailscale is missing', async () => {
    const runCommand = vi.fn(async (command: string, args: string[]) => {
      const key = `${command} ${args.join(' ')}`
      if (key === 'lsof -nP -iTCP:3000 -sTCP:LISTEN') {
        return commandResult({
          stdout: 'node 1 me 1u IPv4 0 0t0 TCP 127.0.0.1:3000 (LISTEN)\n',
        })
      }
      if (key === 'lsof -nP -iTCP:18789 -sTCP:LISTEN') {
        return commandResult({
          code: 1,
          ok: false,
        })
      }
      if (key === 'tailscale version') {
        return commandResult({
          ok: false,
          notFound: true,
          error: 'spawn tailscale ENOENT',
        })
      }
      if (key === 'ssh -V') {
        return commandResult({
          stderr: 'OpenSSH_10.0p2',
        })
      }
      return commandResult()
    })

    const mod = await import('@/lib/system/tailscale-readiness')
    const report = await mod.getTailscaleReadinessReport({
      runCommand,
      getHostname: () => 'fallback-host',
    })

    expect(report.summary.state).toBe('warning')
    expect(report.checks.find((check) => check.id === 'tailscale_cli')?.state).toBe('warning')
    expect(report.checks.find((check) => check.id === 'tailscale_status')?.state).toBe('unknown')
    expect(report.checks.find((check) => check.id === 'tailscale_serve')?.state).toBe('unknown')
  })
})
