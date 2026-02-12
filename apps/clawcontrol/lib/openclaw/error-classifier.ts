import 'server-only'

export type ErrorCategory =
  | 'configuration'
  | 'plugin'
  | 'context_limit'
  | 'gateway'
  | 'security'
  | 'command_failure'
  | 'diagnostic'
  | 'unknown'

export type ErrorSeverity = 'critical' | 'high' | 'medium' | 'low'
export type ErrorDetectability = 'deterministic' | 'heuristic' | 'unknown'

export type MaintenanceActionTarget =
  | 'health'
  | 'doctor'
  | 'doctor-fix'
  | 'gateway-restart'
  | 'security-audit-fix'

export interface ErrorSuggestedAction {
  id: string
  label: string
  description: string
  kind: 'maintenance' | 'cli' | 'manual'
  maintenanceAction?: MaintenanceActionTarget
  command?: string
}

export interface ErrorClassification {
  title: string
  category: ErrorCategory
  severity: ErrorSeverity
  detectability: ErrorDetectability
  confidence: number
  actionable: boolean
  explanation: string
  suggestedActions: ErrorSuggestedAction[]
  extractedCliCommand: string | null
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => text.includes(needle))
}

function cleanupCommand(cmd: string): string {
  return cmd
    .trim()
    .replace(/^`+|`+$/g, '')
    .replace(/[;.,]+$/g, '')
}

export function extractSuggestedCliCommand(input: string): string | null {
  const fromRun = input.match(/(?:^|[\s|])Run:\s*(openclaw[^\n|]+)/i)
  if (fromRun?.[1]) return cleanupCommand(fromRun[1])

  const fromInlineCode = input.match(/`(openclaw\s+[^`]+)`/i)
  if (fromInlineCode?.[1]) return cleanupCommand(fromInlineCode[1])

  return null
}

function baseManualAction(id: string, label: string, description: string): ErrorSuggestedAction {
  return { id, label, description, kind: 'manual' }
}

function cliAction(id: string, label: string, command: string, description: string): ErrorSuggestedAction {
  return { id, label, command, description, kind: 'cli' }
}

function maintenanceAction(
  id: string,
  label: string,
  maintenance: MaintenanceActionTarget,
  description: string,
  command?: string
): ErrorSuggestedAction {
  return {
    id,
    label,
    description,
    kind: 'maintenance',
    maintenanceAction: maintenance,
    command,
  }
}

export function classifyErrorSignature(input: {
  signatureText: string
  sample: string
  sampleRawRedacted?: string | null
}): ErrorClassification {
  const corpus = `${input.signatureText}\n${input.sample}\n${input.sampleRawRedacted ?? ''}`.toLowerCase()
  const extractedCliCommand = extractSuggestedCliCommand(`${input.sample}\n${input.sampleRawRedacted ?? ''}`)

  if (hasAny(corpus, ['context size', 'input is longer than the context size', 'maximum context length'])) {
    return {
      title: 'Context Window Exceeded',
      category: 'context_limit',
      severity: 'medium',
      detectability: 'deterministic',
      confidence: 0.96,
      actionable: true,
      explanation: 'Requests are exceeding model context limits. This is detectable directly from gateway/runtime errors.',
      extractedCliCommand,
      suggestedActions: [
        baseManualAction(
          'increase-context-window',
          'Increase context window',
          'Use a model/configuration with a larger context size and retry the workload.'
        ),
        baseManualAction(
          'shrink-injected-context',
          'Reduce injected context',
          'Trim workspace/context injection for this agent to keep prompts within limits.'
        ),
      ],
    }
  }

  if (hasAny(corpus, ['plugin disabled', 'config warnings', 'config was last written by a newer'])) {
    const command = extractedCliCommand ?? 'openclaw doctor --fix'
    return {
      title: 'Configuration Drift or Plugin Misconfiguration',
      category: hasAny(corpus, ['plugin']) ? 'plugin' : 'configuration',
      severity: 'medium',
      detectability: 'deterministic',
      confidence: 0.93,
      actionable: true,
      explanation: 'Config/version mismatch and disabled plugin signatures map to known OpenClaw remediation flows.',
      extractedCliCommand,
      suggestedActions: [
        maintenanceAction(
          'doctor-fix',
          'Run Doctor Auto-Fix',
          'doctor-fix',
          'Apply automatic OpenClaw diagnostics and config fixes.',
          command
        ),
        cliAction(
          'cli-doctor-fix',
          'Copy CLI Fix Command',
          command,
          'Run the suggested CLI remediation command directly.'
        ),
      ],
    }
  }

  if (hasAny(corpus, ['gateway', 'econnrefused', 'connection refused', 'timed out', 'timeout'])) {
    return {
      title: 'Gateway Availability or Runtime Failure',
      category: 'gateway',
      severity: 'high',
      detectability: 'heuristic',
      confidence: 0.84,
      actionable: true,
      explanation: 'The signature indicates gateway instability or process availability issues.',
      extractedCliCommand,
      suggestedActions: [
        maintenanceAction(
          'gateway-restart',
          'Restart Gateway',
          'gateway-restart',
          'Restart the gateway process and re-check health.'
        ),
        maintenanceAction(
          'run-health-check',
          'Run Health Check',
          'health',
          'Verify the gateway is reachable and healthy after restart.'
        ),
      ],
    }
  }

  if (hasAny(corpus, ['security audit', 'credential', 'token expired', 'invalid token', 'unauthorized'])) {
    return {
      title: 'Security or Credential Issue',
      category: 'security',
      severity: 'high',
      detectability: 'heuristic',
      confidence: 0.8,
      actionable: true,
      explanation: 'The signature suggests auth/credential risk or security policy violations.',
      extractedCliCommand,
      suggestedActions: [
        maintenanceAction(
          'security-audit-fix',
          'Run Security Audit Fix',
          'security-audit-fix',
          'Run security audit with fix mode for safe remediations.'
        ),
      ],
    }
  }

  if (hasAny(corpus, ['command exited with code', 'exit code'])) {
    return {
      title: 'Command Execution Failure',
      category: 'command_failure',
      severity: 'medium',
      detectability: 'deterministic',
      confidence: 0.9,
      actionable: true,
      explanation: 'A gateway-managed command failed and can usually be diagnosed by doctor + logs.',
      extractedCliCommand,
      suggestedActions: [
        maintenanceAction(
          'run-doctor',
          'Run Doctor',
          'doctor',
          'Run diagnostics to identify the failing subsystem.'
        ),
        ...(extractedCliCommand
          ? [
              cliAction(
                'copy-extracted-command',
                'Copy Suggested Command',
                extractedCliCommand,
                'Use the command embedded in the error for targeted remediation.'
              ),
            ]
          : []),
      ],
    }
  }

  return {
    title: 'Unclassified Gateway Error Signature',
    category: 'unknown',
    severity: 'low',
    detectability: 'unknown',
    confidence: 0.35,
    actionable: extractedCliCommand !== null,
    explanation: 'No deterministic rule matched this signature yet. Manual triage is recommended.',
    extractedCliCommand,
    suggestedActions: extractedCliCommand
      ? [
          cliAction(
            'copy-extracted-command',
            'Copy Suggested Command',
            extractedCliCommand,
            'Run the command suggested by the error output.'
          ),
        ]
      : [
          baseManualAction(
            'manual-triage',
            'Manual Triage',
            'Open logs and inspect surrounding events to identify the failing component.'
          ),
        ],
  }
}
