import type {
  AuthProfile,
  AvailableModelProvider,
  ModelAuthMethod,
  ModelStatusResponse,
  ProviderAuth,
} from '@/lib/http'

type ProviderEffectiveAuth = ModelStatusResponse['auth']['providers'][number]

export type ProviderAuthUiStatus = ProviderAuth['status']

export interface NormalizedProviderAuth {
  provider: string
  status: ProviderAuthUiStatus
  profiles: AuthProfile[]
  remainingMs?: number
  expiresAt?: number
  supportsOauth: boolean
  supportsApiKey: boolean
  hasConfiguredAuth: boolean
}

export function getAuthAction(
  status: ProviderAuthUiStatus,
  supportsOauth: boolean,
  options: {
    allowProactive?: boolean
    hasRemaining?: boolean
  } = {}
): { label: 'Authenticate' | 'Re-authenticate'; authMethod: ModelAuthMethod } | null {
  const allowProactive = options.allowProactive === true
  const hasRemaining = options.hasRemaining === true

  if (status === 'missing') {
    return {
      label: 'Authenticate',
      authMethod: supportsOauth ? 'oauth' : 'apiKey',
    }
  }

  if (status === 'expired') {
    return {
      label: 'Re-authenticate',
      authMethod: supportsOauth ? 'oauth' : 'apiKey',
    }
  }

  if (
    allowProactive
    && supportsOauth
    && (status === 'expiring' || (status === 'ok' && hasRemaining))
  ) {
    return {
      label: 'Re-authenticate',
      authMethod: 'oauth',
    }
  }

  return null
}

function parseProviderId(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const match = trimmed.match(/^([a-z0-9._-]+)/i)
  return match?.[1]?.toLowerCase() ?? null
}

function isConfiguredEffectiveAuth(provider: ProviderEffectiveAuth | undefined): boolean {
  if (!provider) return false

  const profileCount = provider.profiles.count ?? 0
  if (profileCount > 0) return true

  const kind = provider.effective.kind.trim().toLowerCase()
  if (!kind) return false

  // "missing"/"none" style kinds should not count as configured auth.
  if (
    kind === 'missing'
    || kind === 'none'
    || kind === 'unconfigured'
    || kind === 'unknown'
  ) {
    return false
  }

  return true
}

function buildOAuthSupportSet(
  status: ModelStatusResponse,
  availableProviders: AvailableModelProvider[]
): Set<string> {
  const supported = new Set<string>()

  for (const provider of availableProviders) {
    if (provider.auth.oauth) supported.add(provider.id.toLowerCase())
  }

  for (const raw of status.auth.providersWithOAuth) {
    const providerId = parseProviderId(raw)
    if (providerId) supported.add(providerId)
  }

  return supported
}

export function normalizeProviderAuthStates(options: {
  status: ModelStatusResponse
  modelProviders: string[]
  availableProviders: AvailableModelProvider[]
}): NormalizedProviderAuth[] {
  const { status, modelProviders, availableProviders } = options

  const effectiveByProvider = new Map<string, ProviderEffectiveAuth>()
  for (const provider of status.auth.providers) {
    effectiveByProvider.set(provider.provider, provider)
  }

  const oauthByProvider = new Map<string, ProviderAuth>()
  for (const provider of status.auth.oauth.providers) {
    oauthByProvider.set(provider.provider, provider)
  }

  const availableByProvider = new Map<string, AvailableModelProvider>()
  for (const provider of availableProviders) {
    availableByProvider.set(provider.id, provider)
  }

  const oauthSupportSet = buildOAuthSupportSet(status, availableProviders)

  const providerIds = new Set<string>([
    ...modelProviders,
    ...status.auth.providers.map((provider) => provider.provider),
    ...status.auth.oauth.providers.map((provider) => provider.provider),
    ...status.auth.missingProvidersInUse,
    ...availableProviders
      .filter((provider) => provider.supported && provider.authStatus !== 'missing')
      .map((provider) => provider.id),
  ])

  const rows: NormalizedProviderAuth[] = []

  for (const provider of providerIds) {
    const effective = effectiveByProvider.get(provider)
    const oauth = oauthByProvider.get(provider)
    const available = availableByProvider.get(provider)

    const hasConfiguredAuth = (
      isConfiguredEffectiveAuth(effective)
      || (oauth?.profiles.length ?? 0) > 0
      || (available?.authStatus !== undefined && available.authStatus !== 'missing')
    )

    const supportsOauth = available?.auth.oauth ?? oauthSupportSet.has(provider.toLowerCase())
    const supportsApiKey = available?.auth.apiKey ?? true

    let statusValue: ProviderAuthUiStatus = oauth?.status ?? available?.authStatus ?? 'missing'
    if (statusValue === 'missing' && hasConfiguredAuth) {
      statusValue = 'ok'
    }

    rows.push({
      provider,
      status: statusValue,
      profiles: oauth?.profiles ?? [],
      remainingMs: oauth?.remainingMs,
      expiresAt: oauth?.expiresAt,
      supportsOauth,
      supportsApiKey,
      hasConfiguredAuth,
    })
  }

  rows.sort((a, b) => a.provider.localeCompare(b.provider))
  return rows
}
