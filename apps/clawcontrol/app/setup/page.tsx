'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Save, FolderOpen } from 'lucide-react'
import { configApi, type InitStatusResponse } from '@/lib/http'
import { cn } from '@/lib/utils'

declare global {
  interface Window {
    clawcontrolDesktop?: {
      pickDirectory: (defaultPath?: string) => Promise<string | null>
      restartServer?: () => Promise<{ ok: boolean; message: string }>
    }
  }
}

function stateTone(state: 'ok' | 'warning' | 'error'): string {
  if (state === 'ok') return 'text-status-success'
  if (state === 'warning') return 'text-status-warning'
  return 'text-status-danger'
}

function StateIcon({ state }: { state: 'ok' | 'warning' | 'error' }) {
  if (state === 'ok') return <CheckCircle2 className="w-4 h-4 text-status-success" />
  if (state === 'warning') return <AlertTriangle className="w-4 h-4 text-status-warning" />
  return <XCircle className="w-4 h-4 text-status-danger" />
}

export default function SetupPage() {
  const router = useRouter()

  const [initStatus, setInitStatus] = useState<InitStatusResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [gatewayHttpUrl, setGatewayHttpUrl] = useState('http://127.0.0.1:18789')
  const [workspacePath, setWorkspacePath] = useState('')

  const [saving, setSaving] = useState(false)
  const [testingGateway, setTestingGateway] = useState(false)
  const [gatewayTestMessage, setGatewayTestMessage] = useState<string | null>(null)
  const [pickerAvailable, setPickerAvailable] = useState(false)

  useEffect(() => {
    setPickerAvailable(typeof window !== 'undefined' && typeof window.clawcontrolDesktop?.pickDirectory === 'function')
  }, [])

  async function load() {
    setLoading(true)
    setError(null)

    try {
      const [statusRes, settingsRes] = await Promise.all([
        configApi.getInitStatus(),
        configApi.getSettings(),
      ])

      setInitStatus(statusRes.data)
      setGatewayHttpUrl(settingsRes.data.settings.gatewayHttpUrl || settingsRes.data.resolved?.gatewayHttpUrl || 'http://127.0.0.1:18789')
      setWorkspacePath(settingsRes.data.settings.workspacePath || settingsRes.data.resolved?.workspacePath || '')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load setup status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const canEnterDashboard = useMemo(() => {
    if (!initStatus) return false
    return initStatus.checks.database.state === 'ok' && initStatus.checks.workspace.state === 'ok'
  }, [initStatus])

  async function handleBrowseWorkspace() {
    if (!pickerAvailable || typeof window === 'undefined') return
    const selected = await window.clawcontrolDesktop?.pickDirectory(workspacePath || undefined)
    if (selected) setWorkspacePath(selected)
  }

  async function handleSaveConfig() {
    setSaving(true)
    setError(null)

    try {
      await configApi.updateSettings({
        gatewayHttpUrl: gatewayHttpUrl || null,
        workspacePath: workspacePath || null,
      })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save configuration')
    } finally {
      setSaving(false)
    }
  }

  async function handleTestGateway() {
    setTestingGateway(true)
    setGatewayTestMessage(null)

    try {
      const res = await configApi.testGateway({
        gatewayHttpUrl,
        withRetry: true,
      })

      if (res.data.state === 'reachable') {
        setGatewayTestMessage('Gateway reachable')
      } else if (res.data.state === 'auth_required') {
        setGatewayTestMessage('Gateway reachable, but authentication token is required')
      } else {
        setGatewayTestMessage('Gateway unreachable')
      }

      await load()
    } catch (err) {
      setGatewayTestMessage(err instanceof Error ? err.message : 'Gateway test failed')
    } finally {
      setTestingGateway(false)
    }
  }

  async function handleCompleteSetup() {
    if (!canEnterDashboard) return

    setSaving(true)
    setError(null)
    try {
      await configApi.updateSettings({
        gatewayHttpUrl: gatewayHttpUrl || null,
        workspacePath: workspacePath || null,
        setupCompleted: true,
      })

      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete setup')
      setSaving(false)
    }
  }

  async function handleContinueLimitedMode() {
    setSaving(true)
    setError(null)

    try {
      await configApi.updateSettings({
        gatewayHttpUrl: gatewayHttpUrl || null,
        workspacePath: workspacePath || null,
        setupCompleted: true,
      })
      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue')
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-0 text-fg-0 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Setup ClawControl</h1>
          <p className="text-sm text-fg-2 mt-1">
            Validate your local environment and save initial gateway/workspace settings.
          </p>
        </header>

        {loading ? (
          <div className="p-4 rounded-[var(--radius-lg)] bg-bg-2 border border-bd-0 flex items-center gap-2 text-fg-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Checking prerequisites...</span>
          </div>
        ) : error ? (
          <div className="p-4 rounded-[var(--radius-lg)] bg-status-danger/10 text-status-danger border border-status-danger/30 flex items-center justify-between">
            <span>{error}</span>
            <button
              onClick={() => void load()}
              className="px-3 py-1.5 text-xs rounded bg-bg-3 text-fg-1 hover:bg-bd-1"
            >
              Retry
            </button>
          </div>
        ) : initStatus ? (
          <>
            <section className="p-4 rounded-[var(--radius-lg)] bg-bg-2 border border-bd-0 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Status Checks</h2>
                <button
                  onClick={() => void load()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded bg-bg-3 text-fg-1 hover:bg-bd-1"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Recheck
                </button>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-2">
                    <StateIcon state={initStatus.checks.database.state} />
                    <span>Database</span>
                  </div>
                  <span className={stateTone(initStatus.checks.database.state)}>{initStatus.checks.database.message}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-2">
                    <StateIcon state={initStatus.checks.workspace.state} />
                    <span>Workspace</span>
                  </div>
                  <span className={stateTone(initStatus.checks.workspace.state)}>{initStatus.checks.workspace.message}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-2">
                    <StateIcon state={initStatus.checks.openclaw.state} />
                    <span>OpenClaw CLI</span>
                  </div>
                  <span className={stateTone(initStatus.checks.openclaw.state)}>{initStatus.checks.openclaw.message}</span>
                </div>

                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-2">
                    <StateIcon state={initStatus.checks.gateway.state} />
                    <span>Gateway</span>
                  </div>
                  <span className={stateTone(initStatus.checks.gateway.state)}>{initStatus.checks.gateway.message}</span>
                </div>
              </div>
            </section>

            <section className="p-4 rounded-[var(--radius-lg)] bg-bg-2 border border-bd-0 space-y-3">
              <h2 className="text-sm font-medium">Configuration</h2>

              <div className="space-y-2">
                <label className="text-xs text-fg-2">Gateway HTTP URL</label>
                <input
                  value={gatewayHttpUrl}
                  onChange={(event) => setGatewayHttpUrl(event.target.value)}
                  placeholder="http://127.0.0.1:18789"
                  className="w-full px-3 py-2 text-sm bg-bg-1 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:border-status-info/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-fg-2">Workspace Path</label>
                <div className="flex gap-2">
                  <input
                    value={workspacePath}
                    onChange={(event) => setWorkspacePath(event.target.value)}
                    placeholder="/path/to/workspace"
                    className="flex-1 px-3 py-2 text-sm bg-bg-1 border border-bd-0 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:border-status-info/50"
                  />
                  {pickerAvailable && (
                    <button
                      onClick={handleBrowseWorkspace}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded bg-bg-3 text-fg-1 hover:bg-bd-1"
                    >
                      <FolderOpen className="w-4 h-4" />
                      Browse
                    </button>
                  )}
                </div>
              </div>

              {gatewayTestMessage && (
                <p className="text-xs text-fg-3">{gatewayTestMessage}</p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleSaveConfig}
                  disabled={saving}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded transition-colors',
                    saving
                      ? 'bg-bg-3 text-fg-3 cursor-not-allowed'
                      : 'bg-status-info text-white hover:bg-status-info/90'
                  )}
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save Configuration
                </button>

                <button
                  onClick={handleTestGateway}
                  disabled={testingGateway}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded transition-colors',
                    testingGateway
                      ? 'bg-bg-3 text-fg-3 cursor-not-allowed'
                      : 'bg-bg-3 text-fg-1 hover:bg-bd-1'
                  )}
                >
                  {testingGateway ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Test Gateway
                </button>
              </div>
            </section>

            <section className="flex flex-wrap gap-2">
              <button
                onClick={handleCompleteSetup}
                disabled={saving || !canEnterDashboard}
                className={cn(
                  'px-4 py-2 text-sm rounded transition-colors',
                  !saving && canEnterDashboard
                    ? 'bg-status-success text-black hover:bg-status-success/90'
                    : 'bg-bg-3 text-fg-3 cursor-not-allowed'
                )}
              >
                Complete Setup
              </button>

              <button
                onClick={handleContinueLimitedMode}
                disabled={saving || !canEnterDashboard}
                className={cn(
                  'px-4 py-2 text-sm rounded transition-colors',
                  !saving && canEnterDashboard
                    ? 'bg-bg-3 text-fg-1 hover:bg-bd-1'
                    : 'bg-bg-3 text-fg-3 cursor-not-allowed'
                )}
              >
                Continue in Limited Mode
              </button>
            </section>
          </>
        ) : null}
      </div>
    </div>
  )
}
