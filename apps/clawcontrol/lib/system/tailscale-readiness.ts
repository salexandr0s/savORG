import 'server-only'

import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getOpenClawConfig } from '@/lib/openclaw-client'
import { readSettings } from '@/lib/settings/store'
import type { RemoteAccessMode } from '@/lib/settings/types'

const execFileAsync = promisify(execFile)
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

type CheckState = 'ok' | 'warning' | 'error' | 'unknown'

interface CommandResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
  notFound: boolean
  error?: string
}

export interface TailscaleReadinessCheck {
  id: string
  title: string
  state: CheckState
  message: string
  detail?: string
}

export interface TailscaleReadinessSummary {
  state: 'ok' | 'warning' | 'error'
  ok: number
  warning: number
  error: number
  unknown: number
}

export interface TailscaleReadinessReport {
  generatedAt: string
  summary: TailscaleReadinessSummary
  checks: TailscaleReadinessCheck[]
  context: {
    remoteAccessMode: RemoteAccessMode
    gatewayUrl: string
    suggestedHost: string
  }
  commands: {
    clawcontrolTunnel: string
    gatewayTunnel: string
  }
}

interface TailscaleReadinessDeps {
  runCommand?: (command: string, args: string[]) => Promise<CommandResult>
  getHostname?: () => string
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  if (LOOPBACK_HOSTS.has(normalized)) return true
  return /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return isLoopbackHostname(parsed.hostname)
  } catch {
    return false
  }
}

async function runLocalCommand(command: string, args: string[]): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: 3000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8',
    })

    return {
      ok: true,
      code: 0,
      stdout: stdout ?? '',
      stderr: stderr ?? '',
      notFound: false,
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      code?: string | number
      stdout?: string
      stderr?: string
    }

    return {
      ok: false,
      code: typeof err.code === 'number' ? err.code : null,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      notFound: err.code === 'ENOENT',
      error: err.message,
    }
  }
}

function parseLsofListenerHosts(output: string): string[] {
  const hosts = new Set<string>()
  const lines = output.split('\n')

  for (const line of lines) {
    const match = line.match(/TCP\s+(\S+)\s+\(LISTEN\)/)
    if (!match) continue

    const address = match[1] ?? ''
    if (!address) continue

    if (address.startsWith('[')) {
      const endBracket = address.indexOf(']')
      if (endBracket !== -1) {
        hosts.add(address.slice(0, endBracket + 1))
        continue
      }
    }

    const lastColon = address.lastIndexOf(':')
    if (lastColon === -1) {
      hosts.add(address)
      continue
    }

    hosts.add(address.slice(0, lastColon))
  }

  return [...hosts]
}

function summarizeChecks(checks: TailscaleReadinessCheck[]): TailscaleReadinessSummary {
  const summary = {
    ok: 0,
    warning: 0,
    error: 0,
    unknown: 0,
  }

  for (const check of checks) {
    summary[check.state] += 1
  }

  const state: TailscaleReadinessSummary['state'] =
    summary.error > 0
      ? 'error'
      : summary.warning > 0 || summary.unknown > 0
        ? 'warning'
        : 'ok'

  return {
    state,
    ...summary,
  }
}

function extractTailscaleHost(statusPayload: unknown, fallbackHost: string): string {
  if (!statusPayload || typeof statusPayload !== 'object') return fallbackHost
  const status = statusPayload as {
    Self?: {
      DNSName?: unknown
      HostName?: unknown
    }
  }

  const dnsName = typeof status.Self?.DNSName === 'string' ? status.Self.DNSName.trim() : ''
  if (dnsName.length > 0) {
    return dnsName.endsWith('.') ? dnsName.slice(0, -1) : dnsName
  }

  const hostName = typeof status.Self?.HostName === 'string' ? status.Self.HostName.trim() : ''
  return hostName.length > 0 ? hostName : fallbackHost
}

function findForbiddenServeExposure(payload: unknown): boolean {
  const hasForbiddenPort = (value: unknown): boolean => {
    if (typeof value === 'number') return value === 3000 || value === 18789
    if (typeof value === 'string') {
      return (
        value === '3000'
        || value === '18789'
        || value.includes(':3000')
        || value.includes(':18789')
      )
    }
    if (Array.isArray(value)) return value.some(hasForbiddenPort)
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>)
        .some(([key, nested]) => hasForbiddenPort(key) || hasForbiddenPort(nested))
    }
    return false
  }

  return hasForbiddenPort(payload)
}

async function checkPortListener(
  runCommand: (command: string, args: string[]) => Promise<CommandResult>,
  port: number,
  title: string
): Promise<TailscaleReadinessCheck> {
  const result = await runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'])
  if (result.notFound) {
    return {
      id: `listener_${port}`,
      title,
      state: 'unknown',
      message: 'Unable to verify: lsof is not installed.',
    }
  }

  if (!result.ok && result.code !== 1) {
    return {
      id: `listener_${port}`,
      title,
      state: 'unknown',
      message: 'Unable to verify listener binding.',
      detail: result.error || result.stderr || undefined,
    }
  }

  const hosts = parseLsofListenerHosts(result.stdout)
  if (hosts.length === 0) {
    return {
      id: `listener_${port}`,
      title,
      state: 'warning',
      message: `No process is listening on port ${port}.`,
    }
  }

  const nonLoopbackHosts = hosts.filter((host) => !isLoopbackHostname(host))
  if (nonLoopbackHosts.length > 0) {
    return {
      id: `listener_${port}`,
      title,
      state: 'error',
      message: `Port ${port} has non-loopback listeners.`,
      detail: nonLoopbackHosts.join(', '),
    }
  }

  return {
    id: `listener_${port}`,
    title,
    state: 'ok',
    message: `Port ${port} is bound to loopback only.`,
    detail: hosts.join(', '),
  }
}

export async function getTailscaleReadinessReport(deps: TailscaleReadinessDeps = {}): Promise<TailscaleReadinessReport> {
  const runCommand = deps.runCommand ?? runLocalCommand
  const getHostname = deps.getHostname ?? (() => os.hostname())

  const [settingsResult, resolvedConfig] = await Promise.all([
    readSettings(),
    getOpenClawConfig(true),
  ])

  const remoteAccessMode: RemoteAccessMode = settingsResult.settings.remoteAccessMode ?? 'local_only'
  const gatewayUrl = resolvedConfig?.gatewayUrl ?? settingsResult.settings.gatewayHttpUrl ?? 'http://127.0.0.1:18789'

  const checks: TailscaleReadinessCheck[] = []

  checks.push({
    id: 'remote_mode',
    title: 'Remote Access Mode',
    state: remoteAccessMode === 'tailscale_tunnel' ? 'ok' : 'warning',
    message: remoteAccessMode === 'tailscale_tunnel'
      ? 'Tailscale tunnel mode is selected.'
      : 'Remote access mode is local_only. Switch to tailscale_tunnel for remote workflow checks.',
  })

  checks.push({
    id: 'gateway_url_loopback',
    title: 'Gateway URL Policy',
    state: isLoopbackUrl(gatewayUrl) ? 'ok' : 'error',
    message: isLoopbackUrl(gatewayUrl)
      ? 'Gateway URL is loopback-only.'
      : 'Gateway URL is not loopback and violates local-only policy.',
    detail: gatewayUrl,
  })

  checks.push(await checkPortListener(runCommand, 3000, 'ClawControl Listener (3000)'))
  checks.push(await checkPortListener(runCommand, 18789, 'OpenClaw Gateway Listener (18789)'))

  const tailscaleVersion = await runCommand('tailscale', ['version'])
  const tailscaleInstalled = !tailscaleVersion.notFound
  if (!tailscaleInstalled) {
    checks.push({
      id: 'tailscale_cli',
      title: 'Tailscale CLI',
      state: 'warning',
      message: 'Tailscale CLI is not installed on this host.',
      detail: tailscaleVersion.error || undefined,
    })
  } else if (!tailscaleVersion.ok) {
    checks.push({
      id: 'tailscale_cli',
      title: 'Tailscale CLI',
      state: 'warning',
      message: 'Tailscale CLI is installed, but version check failed.',
      detail: tailscaleVersion.error || tailscaleVersion.stderr || undefined,
    })
  } else {
    checks.push({
      id: 'tailscale_cli',
      title: 'Tailscale CLI',
      state: 'ok',
      message: 'Tailscale CLI is available.',
      detail: (tailscaleVersion.stdout || tailscaleVersion.stderr).trim().split('\n')[0] || undefined,
    })
  }

  let suggestedHost = getHostname()
  if (tailscaleInstalled) {
    const tailscaleStatus = await runCommand('tailscale', ['status', '--json'])
    if (!tailscaleStatus.ok) {
      checks.push({
        id: 'tailscale_status',
        title: 'Tailnet Connectivity',
        state: 'warning',
        message: 'Unable to read tailnet status.',
        detail: tailscaleStatus.error || tailscaleStatus.stderr || undefined,
      })
    } else {
      try {
        const payload = JSON.parse(tailscaleStatus.stdout) as {
          BackendState?: string
          Self?: { Online?: boolean }
          Peer?: Record<string, unknown>
        }
        suggestedHost = extractTailscaleHost(payload, suggestedHost)
        const online = payload.BackendState === 'Running' && payload.Self?.Online !== false
        const peerCount = payload.Peer ? Object.keys(payload.Peer).length : 0

        checks.push({
          id: 'tailscale_status',
          title: 'Tailnet Connectivity',
          state: online ? 'ok' : 'warning',
          message: online
            ? `Connected to tailnet with ${peerCount} peer(s) discovered.`
            : `Tailscale backend is not fully connected (${payload.BackendState || 'unknown'}).`,
        })
      } catch {
        checks.push({
          id: 'tailscale_status',
          title: 'Tailnet Connectivity',
          state: 'unknown',
          message: 'Failed to parse tailscale status output.',
        })
      }
    }

    const serveStatus = await runCommand('tailscale', ['serve', 'status', '--json'])
    if (serveStatus.ok) {
      try {
        const payload = JSON.parse(serveStatus.stdout)
        const forbiddenExposure = findForbiddenServeExposure(payload)
        checks.push({
          id: 'tailscale_serve',
          title: 'Forbidden Tailscale Serve Exposure',
          state: forbiddenExposure ? 'error' : 'ok',
          message: forbiddenExposure
            ? 'Potential ClawControl/OpenClaw port exposure detected in tailscale serve config.'
            : 'No ClawControl/OpenClaw port exposure detected in tailscale serve config.',
        })
      } catch {
        checks.push({
          id: 'tailscale_serve',
          title: 'Forbidden Tailscale Serve Exposure',
          state: 'unknown',
          message: 'Unable to parse tailscale serve status output.',
        })
      }
    } else {
      const combined = `${serveStatus.stdout}\n${serveStatus.stderr}`.toLowerCase()
      const noServeConfig =
        combined.includes('no serve config')
        || combined.includes('not serving')
        || combined.includes('serve is not configured')

      checks.push({
        id: 'tailscale_serve',
        title: 'Forbidden Tailscale Serve Exposure',
        state: noServeConfig ? 'ok' : 'unknown',
        message: noServeConfig
          ? 'No tailscale serve configuration found.'
          : 'Unable to verify tailscale serve configuration.',
        detail: noServeConfig ? undefined : (serveStatus.error || serveStatus.stderr || undefined),
      })
    }
  } else {
    checks.push({
      id: 'tailscale_status',
      title: 'Tailnet Connectivity',
      state: 'unknown',
      message: 'Skipped because Tailscale CLI is unavailable.',
    })
    checks.push({
      id: 'tailscale_serve',
      title: 'Forbidden Tailscale Serve Exposure',
      state: 'unknown',
      message: 'Skipped because Tailscale CLI is unavailable.',
    })
  }

  const sshCheck = await runCommand('ssh', ['-V'])
  const sshOutput = (sshCheck.stderr || sshCheck.stdout).trim().split('\n')[0] || ''
  checks.push({
    id: 'ssh_client',
    title: 'SSH Client',
    state: sshCheck.ok || sshOutput.includes('OpenSSH')
      ? 'ok'
      : sshCheck.notFound
        ? 'error'
        : 'warning',
    message: sshCheck.ok || sshOutput.includes('OpenSSH')
      ? 'SSH client is available for tunnel commands.'
      : sshCheck.notFound
        ? 'SSH client is not installed on this machine.'
        : 'Unable to verify SSH client availability.',
    detail: sshOutput || sshCheck.error || undefined,
  })

  const summary = summarizeChecks(checks)
  const targetHost = suggestedHost || '<host-tailnet-name>'

  return {
    generatedAt: new Date().toISOString(),
    summary,
    checks,
    context: {
      remoteAccessMode,
      gatewayUrl,
      suggestedHost: targetHost,
    },
    commands: {
      clawcontrolTunnel: `ssh -L 3000:127.0.0.1:3000 <user>@${targetHost}`,
      gatewayTunnel: `ssh -L 18789:127.0.0.1:18789 <user>@${targetHost}`,
    },
  }
}
