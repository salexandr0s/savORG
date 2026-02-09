import { create } from 'zustand'
import { pluginsApi, type PluginResponseMeta } from '@/lib/http'
import type { PluginDTO } from '@/lib/data'

export const PLUGINS_TAB_STALE_TIME_MS = 60_000

interface PluginsTabSnapshot {
  plugins: PluginDTO[]
  meta: PluginResponseMeta | undefined
  fetchedAt: number | null
  isLoading: boolean
  isRefreshing: boolean
  error: string | null
}

type PluginsTabStore = PluginsTabSnapshot

const INITIAL_STATE: PluginsTabSnapshot = {
  plugins: [],
  meta: undefined,
  fetchedAt: null,
  isLoading: true,
  isRefreshing: false,
  error: null,
}

let inFlight: Promise<{ plugins: PluginDTO[]; meta: PluginResponseMeta }> | null = null

export const usePluginsTabStore = create<PluginsTabStore>(() => ({
  ...INITIAL_STATE,
}))

function hasFreshData(state: PluginsTabSnapshot): boolean {
  if (state.fetchedAt === null) return false
  return (Date.now() - state.fetchedAt) < PLUGINS_TAB_STALE_TIME_MS
}

export function seedPluginsTabCache(plugins: PluginDTO[], meta?: PluginResponseMeta): void {
  usePluginsTabStore.setState({
    plugins,
    meta,
    fetchedAt: Date.now(),
    isLoading: false,
    isRefreshing: false,
    error: null,
  })
}

export async function revalidatePluginsTabCache(
  options: { force?: boolean; blocking?: boolean } = {}
): Promise<{ plugins: PluginDTO[]; meta: PluginResponseMeta }> {
  const force = options.force === true
  const state = usePluginsTabStore.getState()

  if (!force && hasFreshData(state) && state.meta) {
    return {
      plugins: state.plugins,
      meta: state.meta,
    }
  }

  if (inFlight) return inFlight

  const blocking = options.blocking ?? state.fetchedAt === null
  usePluginsTabStore.setState({
    isLoading: blocking,
    isRefreshing: !blocking,
    error: null,
  })

  inFlight = pluginsApi.list()
    .then((result) => {
      usePluginsTabStore.setState({
        plugins: result.data,
        meta: result.meta,
        fetchedAt: Date.now(),
        error: null,
      })
      return {
        plugins: result.data,
        meta: result.meta,
      }
    })
    .catch((err) => {
      usePluginsTabStore.setState({
        error: err instanceof Error ? err.message : 'Failed to load plugins',
      })
      throw err
    })
    .finally(() => {
      inFlight = null
      usePluginsTabStore.setState({
        isLoading: false,
        isRefreshing: false,
      })
    })

  return inFlight
}

export function resetPluginsTabCacheForTests(): void {
  inFlight = null
  usePluginsTabStore.setState({ ...INITIAL_STATE })
}
