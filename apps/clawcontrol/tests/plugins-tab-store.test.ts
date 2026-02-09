import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { PluginDTO } from '@/lib/data'
import type { PluginResponseMeta } from '@/lib/http'

const mockPluginsList = vi.fn()

vi.mock('@/lib/http', () => ({
  pluginsApi: {
    list: mockPluginsList,
  },
}))

function buildMeta(): PluginResponseMeta {
  return {
    source: 'openclaw_cli',
    degraded: false,
    capabilities: {
      supported: true,
      listJson: true,
      infoJson: true,
      doctor: true,
      install: true,
      enable: true,
      disable: true,
      uninstall: true,
      setConfig: true,
    },
  }
}

describe('plugins-tab-store', () => {
  beforeEach(async () => {
    vi.useRealTimers()
    mockPluginsList.mockReset()
    vi.resetModules()

    const mod = await import('@/lib/stores/plugins-tab-store')
    mod.resetPluginsTabCacheForTests()
  })

  it('returns cached data when fresh metadata exists', async () => {
    const mod = await import('@/lib/stores/plugins-tab-store')
    const cachedPlugins = [
      { id: 'plugin-1', name: 'Plugin One' },
    ] as unknown as PluginDTO[]
    const meta = buildMeta()

    mod.seedPluginsTabCache(cachedPlugins, meta)

    const result = await mod.revalidatePluginsTabCache({ force: false })

    expect(result.plugins).toEqual(cachedPlugins)
    expect(result.meta).toEqual(meta)
    expect(mockPluginsList).not.toHaveBeenCalled()
  })

  it('revalidates stale cache once and dedupes in-flight requests', async () => {
    const mod = await import('@/lib/stores/plugins-tab-store')
    const stalePlugins = [
      { id: 'plugin-stale', name: 'Stale Plugin' },
    ] as unknown as PluginDTO[]
    const freshPlugins = [
      { id: 'plugin-fresh', name: 'Fresh Plugin' },
    ] as unknown as PluginDTO[]
    const meta = buildMeta()

    mod.usePluginsTabStore.setState({
      plugins: stalePlugins,
      meta,
      fetchedAt: Date.now() - mod.PLUGINS_TAB_STALE_TIME_MS - 1,
      isLoading: false,
      isRefreshing: false,
      error: null,
    })

    let resolveList!: (value: { data: PluginDTO[]; meta: PluginResponseMeta }) => void
    mockPluginsList.mockImplementation(
      () => new Promise<{ data: PluginDTO[]; meta: PluginResponseMeta }>((resolve) => {
        resolveList = resolve
      })
    )

    const requestA = mod.revalidatePluginsTabCache({ force: false, blocking: false })
    const requestB = mod.revalidatePluginsTabCache({ force: false, blocking: false })

    expect(mockPluginsList).toHaveBeenCalledTimes(1)

    resolveList({ data: freshPlugins, meta })

    const [resultA, resultB] = await Promise.all([requestA, requestB])
    expect(resultA).toEqual({ plugins: freshPlugins, meta })
    expect(resultB).toEqual({ plugins: freshPlugins, meta })

    const state = mod.usePluginsTabStore.getState()
    expect(state.plugins).toEqual(freshPlugins)
    expect(state.meta).toEqual(meta)
    expect(state.fetchedAt).not.toBeNull()
    expect(state.isLoading).toBe(false)
    expect(state.isRefreshing).toBe(false)
  })
})
