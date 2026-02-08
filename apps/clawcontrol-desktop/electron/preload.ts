import { contextBridge, ipcRenderer } from 'electron'

interface DirectoryPickerResponse {
  canceled: boolean
  path: string | null
}

interface ServerRestartResponse {
  ok: boolean
  message: string
}

interface DesktopSettingsPayload {
  gatewayHttpUrl?: string | null
  gatewayWsUrl?: string | null
  gatewayToken?: string | null
  workspacePath?: string | null
  setupCompleted?: boolean
}

contextBridge.exposeInMainWorld('clawcontrolDesktop', {
  pickDirectory: async (defaultPath?: string): Promise<string | null> => {
    const result = await ipcRenderer.invoke('clawcontrol:pick-directory', {
      defaultPath,
    }) as DirectoryPickerResponse

    if (!result || result.canceled) return null
    return result.path
  },

  restartServer: async (): Promise<ServerRestartResponse> =>
    ipcRenderer.invoke('clawcontrol:restart-server') as Promise<ServerRestartResponse>,

  getSettings: async (): Promise<unknown> =>
    ipcRenderer.invoke('clawcontrol:get-settings') as Promise<unknown>,

  saveSettings: async (payload: DesktopSettingsPayload): Promise<unknown> =>
    ipcRenderer.invoke('clawcontrol:save-settings', payload) as Promise<unknown>,

  getInitStatus: async (): Promise<unknown> =>
    ipcRenderer.invoke('clawcontrol:get-init-status') as Promise<unknown>,

  testGateway: async (payload?: { gatewayHttpUrl?: string; gatewayToken?: string; withRetry?: boolean }): Promise<unknown> =>
    ipcRenderer.invoke('clawcontrol:test-gateway', payload ?? {}) as Promise<unknown>,
})
