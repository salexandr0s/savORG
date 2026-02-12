import { describe, expect, it } from 'vitest'
import type { AvailableModelProvider, ModelStatusResponse } from '@/lib/http'
import {
  getAuthAction,
  normalizeProviderAuthStates,
} from '@/app/(dashboard)/models/provider-auth-state'

function makeStatus(overrides?: Partial<ModelStatusResponse>): ModelStatusResponse {
  return {
    configPath: '/tmp/openclaw.json',
    agentDir: '/tmp/agent',
    defaultModel: 'anthropic/claude-opus-4-5',
    resolvedDefault: 'anthropic/claude-opus-4-5',
    fallbacks: [],
    imageModel: null,
    imageFallbacks: [],
    aliases: {},
    allowed: [],
    auth: {
      storePath: '/tmp/auth-profiles.json',
      shellEnvFallback: {
        enabled: false,
        appliedKeys: [],
      },
      providersWithOAuth: [],
      missingProvidersInUse: [],
      providers: [],
      unusableProfiles: [],
      oauth: {
        warnAfterMs: 86_400_000,
        profiles: [],
        providers: [],
      },
    },
    ...overrides,
  }
}

function makeProvider(overrides: Partial<AvailableModelProvider>): AvailableModelProvider {
  return {
    id: 'openai',
    label: 'OpenAI',
    supported: true,
    authStatus: 'missing',
    auth: {
      apiKey: true,
      oauth: false,
      oauthRequiresTty: true,
    },
    ...overrides,
  }
}

describe('models provider auth state', () => {
  it('marks env-auth providers as active when OAuth view reports missing', () => {
    const status = makeStatus({
      auth: {
        ...makeStatus().auth,
        providers: [
          {
            provider: 'openai',
            effective: { kind: 'env', detail: 'env: OPENAI_API_KEY' },
            profiles: {
              count: 0,
              oauth: 0,
              token: 0,
              apiKey: 0,
              labels: [],
            },
          },
        ],
        oauth: {
          ...makeStatus().auth.oauth,
          providers: [
            {
              provider: 'openai',
              status: 'missing',
              profiles: [],
            },
          ],
        },
      },
    })

    const rows = normalizeProviderAuthStates({
      status,
      modelProviders: ['openai'],
      availableProviders: [
        makeProvider({
          id: 'openai',
          auth: { apiKey: true, oauth: true, oauthRequiresTty: true },
          authStatus: 'missing',
        }),
      ],
    })

    const openai = rows.find((row) => row.provider === 'openai')
    expect(openai?.status).toBe('ok')
    expect(openai?.hasConfiguredAuth).toBe(true)
  })

  it('keeps missing providers as missing when no auth is configured', () => {
    const status = makeStatus({
      auth: {
        ...makeStatus().auth,
        missingProvidersInUse: ['openai'],
        providers: [
          {
            provider: 'openai',
            effective: { kind: 'missing', detail: 'none' },
            profiles: {
              count: 0,
              oauth: 0,
              token: 0,
              apiKey: 0,
              labels: [],
            },
          },
        ],
        oauth: {
          ...makeStatus().auth.oauth,
          providers: [
            {
              provider: 'openai',
              status: 'missing',
              profiles: [],
            },
          ],
        },
      },
    })

    const rows = normalizeProviderAuthStates({
      status,
      modelProviders: ['openai'],
      availableProviders: [makeProvider({ id: 'openai' })],
    })

    const openai = rows.find((row) => row.provider === 'openai')
    expect(openai?.status).toBe('missing')
    expect(openai?.hasConfiguredAuth).toBe(false)
  })

  it('returns auth action labels and methods for missing/expired states', () => {
    expect(getAuthAction('missing', true)).toEqual({
      label: 'Authenticate',
      authMethod: 'oauth',
    })

    expect(getAuthAction('expired', false)).toEqual({
      label: 'Re-authenticate',
      authMethod: 'apiKey',
    })

    expect(getAuthAction('ok', true)).toBeNull()
    expect(getAuthAction('expiring', true)).toBeNull()
  })
})
