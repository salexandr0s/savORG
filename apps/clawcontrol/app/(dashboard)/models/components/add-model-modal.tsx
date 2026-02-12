'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, SegmentedToggle } from '@clawcontrol/ui'
import { Modal } from '@/components/ui/modal'
import {
  openclawModelsApi,
  type AvailableModelProvider,
  type ModelAuthMethod,
  HttpError,
} from '@/lib/http'
import { ArrowLeft, KeyRound, Terminal, Copy, Check, Play } from 'lucide-react'
import { LoadingSpinner } from '@/components/ui/loading-state'
import { ProviderCard } from './provider-card'

type Step = 'provider' | 'auth'
type DesktopBridge = {
  runModelAuthLogin?: (providerId: string) => Promise<{ ok: boolean; message?: string }>
}

function getDesktopBridge(): DesktopBridge | null {
  if (typeof window === 'undefined') return null
  const scopedWindow = window as Window & { clawcontrolDesktop?: DesktopBridge }
  return scopedWindow.clawcontrolDesktop ?? null
}

export function AddModelModal({
  open,
  onClose,
  onAdded,
  initialProviderId,
  initialAuthMethod,
}: {
  open: boolean
  onClose: () => void
  onAdded: () => void | Promise<void>
  initialProviderId?: string | null
  initialAuthMethod?: ModelAuthMethod | null
}) {
  const [step, setStep] = useState<Step>('provider')
  const [providers, setProviders] = useState<AvailableModelProvider[]>([])
  const [isLoadingProviders, setIsLoadingProviders] = useState(false)
  const [providerSearch, setProviderSearch] = useState('')
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)

  const [authMethod, setAuthMethod] = useState<ModelAuthMethod>('apiKey')
  const [apiKey, setApiKey] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isRunningOauthCommand, setIsRunningOauthCommand] = useState(false)
  const [canRunOauthCommand, setCanRunOauthCommand] = useState(false)
  const [oauthCommandCopied, setOauthCommandCopied] = useState(false)
  const [oauthNotice, setOauthNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  )

  useEffect(() => {
    if (!open) return

    setStep('provider')
    setSelectedProviderId(null)
    setAuthMethod('apiKey')
    setApiKey('')
    setProviderSearch('')
    setIsRunningOauthCommand(false)
    setOauthCommandCopied(false)
    setOauthNotice(null)
    setError(null)
    setCanRunOauthCommand(
      typeof getDesktopBridge()?.runModelAuthLogin === 'function'
    )

    let cancelled = false

    const resolveAuthMethod = (
      provider: AvailableModelProvider,
      preferredMethod?: ModelAuthMethod | null
    ): ModelAuthMethod => {
      if (preferredMethod === 'oauth' && provider.auth.oauth) return 'oauth'
      if (preferredMethod === 'apiKey') return 'apiKey'
      return provider.auth.oauth ? 'oauth' : 'apiKey'
    }

    async function load() {
      setIsLoadingProviders(true)
      try {
        const res = await openclawModelsApi.getAvailable()
        if (cancelled) return
        const nextProviders = res.data.providers ?? []
        setProviders(nextProviders)

        if (initialProviderId) {
          const initialProvider = nextProviders.find((provider) => provider.id === initialProviderId)
          if (initialProvider?.supported) {
            setSelectedProviderId(initialProvider.id)
            setStep('auth')
            setAuthMethod(resolveAuthMethod(initialProvider, initialAuthMethod))
          }
        }
      } catch (err) {
        if (cancelled) return
        setProviders([])
        setError(err instanceof HttpError ? err.message : 'Failed to load providers')
      } finally {
        if (!cancelled) setIsLoadingProviders(false)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [open, initialProviderId, initialAuthMethod])

  useEffect(() => {
    if (!oauthCommandCopied) return
    const timeoutId = window.setTimeout(() => setOauthCommandCopied(false), 1200)
    return () => window.clearTimeout(timeoutId)
  }, [oauthCommandCopied])

  const supportedProviders = useMemo(
    () => providers.filter((p) => p.supported),
    [providers]
  )

  const filteredProviders = useMemo(() => {
    const q = providerSearch.trim().toLowerCase()
    const sorted = [...supportedProviders].sort((a, b) => a.label.localeCompare(b.label))
    if (!q) return sorted
    return sorted.filter((p) =>
      p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    )
  }, [providerSearch, supportedProviders])

  const handleSelectProvider = (providerId: string) => {
    setSelectedProviderId(providerId)
    setStep('auth')
    setAuthMethod('apiKey')
    setApiKey('')
    setError(null)
  }

  const handleBack = () => {
    setStep('provider')
    setAuthMethod('apiKey')
    setApiKey('')
    setError(null)
  }

  const oauthCommand =
    selectedProvider ? `openclaw models auth login --provider ${selectedProvider.id}` : ''

  const handleCopyOauthCommand = async () => {
    if (!oauthCommand) return
    try {
      await navigator.clipboard.writeText(oauthCommand)
      setOauthCommandCopied(true)
      setOauthNotice(null)
    } catch {
      setError('Failed to copy command')
    }
  }

  const handleRunOauthCommand = async () => {
    if (!selectedProvider) return
    const runLogin = getDesktopBridge()?.runModelAuthLogin
    if (typeof runLogin !== 'function') {
      setError('Run in Terminal is only available in the desktop app.')
      return
    }

    setIsRunningOauthCommand(true)
    setError(null)
    setOauthNotice(null)
    try {
      const result = await runLogin(selectedProvider.id)
      if (!result.ok) {
        setError(result.message ?? 'Failed to launch terminal command.')
        return
      }
      setOauthNotice(result.message ?? 'Opened terminal. Complete OAuth there, then return and click Refresh.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch terminal command.')
    } finally {
      setIsRunningOauthCommand(false)
    }
  }

  const handleSubmitApiKey = async () => {
    if (!selectedProvider) return
    if (!apiKey.trim()) {
      setError('API key is required')
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      await openclawModelsApi.add({
        provider: selectedProvider.id,
        authMethod: 'apiKey',
        apiKey: apiKey.trim(),
      })
      await onAdded()
      onClose()
    } catch (err) {
      setError(err instanceof HttpError ? err.message : 'Failed to add model provider')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={step === 'provider' ? 'Add Model Provider' : selectedProvider?.label ?? 'Add Model Provider'}
      description={
        step === 'provider'
          ? 'Choose a provider to authenticate'
          : selectedProvider
            ? `Authenticate ${selectedProvider.label}`
            : undefined
      }
      width="lg"
    >
      {error && (
        <div className="mb-4 p-3 bg-status-danger/10 border border-status-danger/20 rounded-[var(--radius-md)] text-status-danger text-sm">
          {error}
        </div>
      )}

      {step === 'provider' && (
        <>
          {isLoadingProviders ? (
            <div className="flex items-center gap-2 text-fg-3 text-sm">
              <LoadingSpinner size="md" />
              <span>Loading providers...</span>
            </div>
          ) : supportedProviders.length === 0 ? (
            <div className="text-sm text-fg-2">
              No providers discovered. Make sure OpenClaw is installed and `openclaw models list --all --json` works.
            </div>
          ) : (
            <>
              <div className="mb-3">
                <input
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                  placeholder="Search providers…"
                  className="w-full px-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-status-info/50"
                />
              </div>

              {filteredProviders.length === 0 ? (
                <div className="text-sm text-fg-2">No matching providers.</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {filteredProviders.map((p) => (
                    <ProviderCard
                      key={p.id}
                      provider={p}
                      selected={p.id === selectedProviderId}
                      onClick={() => handleSelectProvider(p.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {step === 'auth' && selectedProvider && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              onClick={handleBack}
              disabled={isSubmitting || isRunningOauthCommand}
              variant="secondary"
              size="sm"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </Button>
          </div>

          <SegmentedToggle
            value={authMethod}
            onChange={setAuthMethod}
            tone="neutral"
            size="sm"
            className="w-fit"
            ariaLabel="Auth method"
            items={[
              { value: 'apiKey', label: 'API Key' },
              ...(selectedProvider.auth.oauth ? [{ value: 'oauth' as const, label: 'OAuth' }] : []),
            ]}
          />

          {authMethod === 'apiKey' && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-fg-2">
                API Key
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-3" />
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Paste your API key"
                    disabled={isSubmitting}
                    className="w-full pl-10 pr-3 py-2 text-sm bg-bg-2 border border-bd-1 rounded-[var(--radius-md)] text-fg-0 placeholder:text-fg-3 focus:outline-none focus:ring-1 focus:ring-status-info/50 disabled:opacity-50"
                    autoFocus
                  />
                </div>
                <Button
                  type="button"
                  onClick={handleSubmitApiKey}
                  disabled={isSubmitting || !apiKey.trim()}
                  variant="primary"
                  size="md"
                >
                  {isSubmitting && <LoadingSpinner size="sm" />}
                  Add
                </Button>
              </div>
              <p className="text-xs text-fg-3">
                The key is written via OpenClaw&apos;s `models auth paste-token` and never stored by the UI.
              </p>
            </div>
          )}

          {authMethod === 'oauth' && (
            <div className="space-y-3">
              <div className="p-3 bg-bg-2 rounded-[var(--radius-md)] border border-bd-0">
                <div className="flex items-start gap-2">
                  <Terminal className="w-4 h-4 text-fg-3 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-sm text-fg-1 mb-2">
                      OAuth login requires an interactive terminal.
                    </div>
                    <pre className="text-xs text-fg-1 font-mono bg-bg-1 border border-bd-1 rounded-[var(--radius-md)] px-3 py-2 overflow-x-auto whitespace-pre-wrap break-all">
                      {oauthCommand}
                    </pre>
                  </div>
                </div>
                <div className="flex justify-end items-center gap-2 mt-3">
                  {canRunOauthCommand && (
                    <Button
                      type="button"
                      onClick={handleRunOauthCommand}
                      variant="secondary"
                      size="sm"
                      disabled={isRunningOauthCommand}
                    >
                      {isRunningOauthCommand ? <LoadingSpinner size="sm" /> : <Play className="w-3.5 h-3.5" />}
                      Run in Terminal
                    </Button>
                  )}
                  <Button
                    type="button"
                    onClick={handleCopyOauthCommand}
                    variant="secondary"
                    size="icon"
                    title={oauthCommandCopied ? 'Copied' : 'Copy command'}
                    aria-label={oauthCommandCopied ? 'Copied command' : 'Copy command'}
                  >
                    {oauthCommandCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </Button>
                </div>
              </div>
              {oauthNotice && (
                <p className="text-xs text-status-success">{oauthNotice}</p>
              )}
              <p className="text-xs text-fg-3">
                {canRunOauthCommand
                  ? 'After completing OAuth, return here and click Refresh.'
                  : 'Run this command in your terminal, then return here and click Refresh.'}
              </p>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
