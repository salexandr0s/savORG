import { NextRequest, NextResponse } from 'next/server'
import { enforceTypedConfirm } from '@/lib/with-governor'
import { getRepos } from '@/lib/repo'
import {
  runCommandJson,
  isAllowedCommand,
  getCommandSpec,
  type AllowedCommandId,
} from '@clawcontrol/adapters-openclaw'
import type { ActionKind } from '@clawcontrol/core'

// Map audit types to command IDs and Governor action kinds
const AUDIT_TYPE_MAP: Record<string, {
  commandId: AllowedCommandId
  actionKind: ActionKind
  activityType: string
}> = {
  'basic': {
    commandId: 'security.audit.json',
    actionKind: 'security.audit',
    activityType: 'security.audit_ran',
  },
  'deep': {
    commandId: 'security.audit.deep.json',
    actionKind: 'security.audit',
    activityType: 'security.audit_deep_ran',
  },
  'fix': {
    commandId: 'security.audit.fix.json',
    actionKind: 'security.audit.fix',
    activityType: 'security.audit_fix_ran',
  },
}

// Types for audit results
interface AuditFinding {
  checkId: string
  severity: 'critical' | 'warn' | 'info'
  title: string
  detail: string
}

interface AuditReport {
  ts: number
  summary: { critical: number; warn: number; info: number }
  findings: AuditFinding[]
  deep?: {
    gateway: {
      attempted: boolean
      url: string
      ok: boolean
      error: string | null
      close: string | null
    }
  }
}

interface FixAction {
  kind: 'chmod'
  path: string
  mode: number
  ok: boolean
  skipped?: 'already' | 'missing'
}

interface FixResult {
  ok: boolean
  stateDir: string
  configPath: string
  configWritten: boolean
  changes: string[]
  actions: FixAction[]
  errors: string[]
}

/**
 * POST /api/security/audit
 * Run a security audit with optional deep probe or fix mode
 */
export async function POST(request: NextRequest) {
  // Parse request body
  let auditType: string = 'basic'
  let typedConfirmText: string | undefined

  try {
    const body = await request.json()
    auditType = body.type || 'basic'
    typedConfirmText = body.typedConfirmText
  } catch {
    // Default to basic audit if body parsing fails
  }

  // Validate audit type
  const auditConfig = AUDIT_TYPE_MAP[auditType]
  if (!auditConfig) {
    return NextResponse.json(
      { error: `Unknown audit type: ${auditType}. Valid types: basic, deep, fix` },
      { status: 400 }
    )
  }

  // Validate command is in allowlist
  if (!isAllowedCommand(auditConfig.commandId)) {
    return NextResponse.json(
      { error: `Command not allowed: ${auditConfig.commandId}` },
      { status: 403 }
    )
  }

  // Enforce Governor gating (fix mode requires confirmation)
  const result = await enforceTypedConfirm({
    actionKind: auditConfig.actionKind,
    typedConfirmText,
  })

  if (!result.allowed) {
    return NextResponse.json(
      {
        error: result.errorType,
        policy: result.policy,
      },
      { status: result.errorType === 'TYPED_CONFIRM_REQUIRED' ? 428 : 403 }
    )
  }

  const repos = getRepos()
  const commandSpec = getCommandSpec(auditConfig.commandId)

  // Create a receipt for this audit
  const receipt = await repos.receipts.create({
    workOrderId: 'system',
    kind: 'manual',
    commandName: `security.audit.${auditType}`,
    commandArgs: {
      type: auditType,
      commandId: auditConfig.commandId,
      description: commandSpec.description,
    },
  })

  try {
    // Execute the command with JSON output
    const cmdResult = await runCommandJson<AuditReport | { fix: FixResult; report: AuditReport }>(
      auditConfig.commandId
    )

    if (cmdResult.error || !cmdResult.data) {
      // Finalize receipt with error
      await repos.receipts.finalize(receipt.id, {
        exitCode: cmdResult.exitCode,
        durationMs: 0,
        parsedJson: {
          type: auditType,
          error: cmdResult.error || 'No data returned',
        },
      })

      return NextResponse.json(
        {
          error: cmdResult.error || 'Audit failed with no output',
          receiptId: receipt.id,
        },
        { status: 500 }
      )
    }

    // Parse the response based on audit type
    let report: AuditReport
    let fix: FixResult | undefined

    if (auditType === 'fix' && 'fix' in cmdResult.data) {
      fix = cmdResult.data.fix
      report = cmdResult.data.report
    } else {
      report = cmdResult.data as AuditReport
    }

    // Finalize receipt with success
    await repos.receipts.finalize(receipt.id, {
      exitCode: 0,
      durationMs: 0,
      parsedJson: {
        type: auditType,
        summary: report.summary,
        findingsCount: report.findings.length,
        hasDeep: !!report.deep,
        hasFix: !!fix,
      },
    })

    // Log activity
    await repos.activities.create({
      type: auditConfig.activityType,
      actor: 'user',
      entityType: 'system',
      entityId: 'security',
      summary: `Ran ${commandSpec.description} - ${report.summary.critical} critical, ${report.summary.warn} warnings, ${report.summary.info} info`,
      payloadJson: {
        type: auditType,
        commandId: auditConfig.commandId,
        summary: report.summary,
        receiptId: receipt.id,
      },
    })

    return NextResponse.json({
      data: {
        report,
        fix,
      },
      receiptId: receipt.id,
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Audit execution failed'

    // Finalize receipt with error
    await repos.receipts.finalize(receipt.id, {
      exitCode: 1,
      durationMs: 0,
      parsedJson: {
        type: auditType,
        error: errorMessage,
      },
    })

    return NextResponse.json(
      {
        error: errorMessage,
        receiptId: receipt.id,
      },
      { status: 500 }
    )
  }
}
