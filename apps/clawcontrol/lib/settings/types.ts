export interface ClawcontrolSettings {
  gatewayHttpUrl?: string
  gatewayWsUrl?: string
  gatewayToken?: string
  workspacePath?: string
  setupCompleted?: boolean
  updatedAt: string
}

export interface SettingsReadResult {
  settings: ClawcontrolSettings
  path: string
  migratedFromEnv: boolean
  legacyEnvPath: string | null
}

export const DEFAULT_GATEWAY_HTTP_URL = 'http://127.0.0.1:18789'
export const DEFAULT_GATEWAY_WS_URL = 'ws://127.0.0.1:18789'
