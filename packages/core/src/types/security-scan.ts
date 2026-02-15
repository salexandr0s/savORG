export type ScanOutcome = 'pass' | 'warn' | 'block'

export type ScanSeverity = 'info' | 'warning' | 'danger'

export type ScanCategory =
  | 'zip'
  | 'templates'
  | 'workflows'
  | 'selection'
  | 'teams'
  | 'secrets'
  | 'prompt_injection'
  | 'policy_bypass'

export interface ScanFinding {
  code: string
  severity: ScanSeverity
  category: ScanCategory
  title: string
  message: string
  path?: string
  /** sha256 of matched evidence snippet (never store raw secrets/snippets) */
  evidenceHash?: string
  recommendation?: string
}

export interface ScanSummaryCounts {
  info: number
  warning: number
  danger: number
}

export interface ScanReport {
  outcome: ScanOutcome
  blocked: boolean
  summaryCounts: ScanSummaryCounts
  findings: ScanFinding[]
  scannerVersion: string
}

