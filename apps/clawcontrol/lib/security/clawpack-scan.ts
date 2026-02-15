import 'server-only'

import { createHash } from 'node:crypto'
import type { ScanFinding, ScanReport, ScanSeverity } from '@clawcontrol/core'

export const CLAWPACK_SCANNER_VERSION = 'v1'

export interface ScanFileInput {
  path: string
  bytes: number
  /**
   * Optional decoded UTF-8 content for text-like files.
   * Never persist raw content; scanning should hash any evidence snippets.
   */
  content?: string | null
}

const ALLOWED_EXTENSIONS = new Set(['.md', '.json', '.yaml', '.yml'])

const SENSITIVE_DOTFILE_NAMES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.git',
  '.ssh',
  'id_rsa',
  'id_ed25519',
])

const SECRET_PATTERNS: Array<{ code: string; title: string; regex: RegExp }> = [
  {
    code: 'PRIVATE_KEY_BLOCK',
    title: 'Private key block detected',
    regex: /-----BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE KEY-----/g,
  },
  {
    code: 'CLERK_SECRET_KEY',
    title: 'Clerk secret key detected',
    regex: /\bsk_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
  },
  {
    code: 'AWS_ACCESS_KEY_ID',
    title: 'AWS access key ID detected',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    code: 'SLACK_TOKEN',
    title: 'Slack token detected',
    regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g,
  },
  {
    code: 'GITHUB_PAT',
    title: 'GitHub token detected',
    regex: /\bghp_[A-Za-z0-9]{20,}\b/g,
  },
]

const INJECTION_PHRASES = [
  'ignore previous instructions',
  'disregard policy',
  'bypass approvals',
  'do not log',
  'exfiltrate',
] as const

const BYPASS_KEYWORDS = [
  'bypass plan_review',
  'bypass plan review',
  'override security veto',
  'disable governor',
  'send secrets',
] as const

const PIPE_TO_SHELL_PATTERNS = [
  /curl\s+[^|\n]{0,200}\|\s*(bash|sh)\b/i,
  /wget\s+[^|\n]{0,200}\|\s*(bash|sh)\b/i,
  /\bchmod\s+\+x\b/i,
] as const

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function getExtension(path: string): string {
  const base = path.split('/').at(-1) ?? path
  const idx = base.lastIndexOf('.')
  if (idx === -1) return ''
  return base.slice(idx).toLowerCase()
}

function baseName(path: string): string {
  return path.split('/').at(-1) ?? path
}

function pushFinding(findings: ScanFinding[], input: ScanFinding) {
  findings.push(input)
}

export function scanClawpackPackage(input: {
  files: ScanFileInput[]
  fileCount: number
  totalBytes: number
}): ScanReport {
  const findings: ScanFinding[] = []

  // Rule: extension allowlist (danger)
  for (const f of input.files) {
    const ext = getExtension(f.path)
    if (!ext || !ALLOWED_EXTENSIONS.has(ext)) {
      pushFinding(findings, {
        code: 'UNSUPPORTED_FILE_EXTENSION',
        severity: 'danger',
        category: 'zip',
        title: 'Unsupported file type',
        message: `File extension not allowed in package: ${f.path}`,
        path: f.path,
        recommendation: 'Remove binary/unknown files; packages must contain only .md/.json/.yaml/.yml.',
      })
    }
  }

  // Rule: dotfiles / sensitive filenames (warning)
  for (const f of input.files) {
    const base = baseName(f.path)
    if (SENSITIVE_DOTFILE_NAMES.has(base) || base.startsWith('.env.')) {
      pushFinding(findings, {
        code: 'SENSITIVE_DOTFILES_PRESENT',
        severity: 'warning',
        category: 'zip',
        title: 'Sensitive dotfiles present',
        message: `Bundle contains potentially sensitive file: ${f.path}`,
        path: f.path,
        recommendation: 'Do not ship credentials or dotfiles inside packages.',
      })
    }

    if (f.path === '.env' || f.path.endsWith('/.env')) {
      pushFinding(findings, {
        code: 'SENSITIVE_DOTFILES_PRESENT',
        severity: 'warning',
        category: 'zip',
        title: 'Sensitive dotfiles present',
        message: `Bundle contains potentially sensitive file: ${f.path}`,
        path: f.path,
        recommendation: 'Do not ship credentials or dotfiles inside packages.',
      })
    }

    if (f.path === '.ssh' || f.path.startsWith('.ssh/') || f.path.includes('/.ssh/')) {
      pushFinding(findings, {
        code: 'SENSITIVE_DOTFILES_PRESENT',
        severity: 'warning',
        category: 'zip',
        title: 'Sensitive dotfiles present',
        message: `Bundle contains potentially sensitive file: ${f.path}`,
        path: f.path,
        recommendation: 'Do not ship credentials or dotfiles inside packages.',
      })
    }
    if (f.path === '.git' || f.path.startsWith('.git/') || f.path.includes('/.git/')) {
      pushFinding(findings, {
        code: 'SENSITIVE_DOTFILES_PRESENT',
        severity: 'warning',
        category: 'zip',
        title: 'Sensitive dotfiles present',
        message: `Bundle contains potentially sensitive file: ${f.path}`,
        path: f.path,
        recommendation: 'Do not ship VCS metadata inside packages.',
      })
    }
  }

  // Rule: size heuristics (warning)
  if (input.fileCount > 250) {
    pushFinding(findings, {
      code: 'ZIP_MANY_FILES',
      severity: 'warning',
      category: 'zip',
      title: 'Large bundle',
      message: `Bundle contains many files: ${input.fileCount}`,
      recommendation: 'Consider splitting the package into smaller parts.',
    })
  }
  if (input.totalBytes > 15 * 1024 * 1024) {
    pushFinding(findings, {
      code: 'ZIP_LARGE_TOTAL',
      severity: 'warning',
      category: 'zip',
      title: 'Large bundle',
      message: `Bundle total size is large: ${Math.round(input.totalBytes / (1024 * 1024))}MB`,
      recommendation: 'Consider reducing large embedded content.',
    })
  }

  // Content scanning rules
  for (const f of input.files) {
    const content = (f.content ?? '').toString()
    if (!content) continue

    // Limit scanning to a bounded prefix to avoid DoS-y payloads.
    const sample = content.slice(0, 200_000)
    const lower = sample.toLowerCase()

    // Secrets (danger)
    for (const pattern of SECRET_PATTERNS) {
      pattern.regex.lastIndex = 0
      const match = pattern.regex.exec(sample)
      if (!match) continue

      pushFinding(findings, {
        code: 'EMBEDDED_SECRET_DETECTED',
        severity: 'danger',
        category: 'secrets',
        title: pattern.title,
        message: `High-confidence secret pattern detected in ${f.path}.`,
        path: f.path,
        evidenceHash: sha256Hex(match[0]),
        recommendation: 'Remove secrets from the package. Use a secret store or runtime environment variables instead.',
      })
    }

    // Policy bypass (danger) vs injection language (warning)
    const hasBypass = BYPASS_KEYWORDS.some((kw) => lower.includes(kw))
    if (hasBypass) {
      pushFinding(findings, {
        code: 'POLICY_BYPASS_INSTRUCTIONS',
        severity: 'danger',
        category: 'policy_bypass',
        title: 'Policy bypass instructions detected',
        message: `Content suggests bypassing governance in ${f.path}.`,
        path: f.path,
        evidenceHash: sha256Hex(BYPASS_KEYWORDS.filter((kw) => lower.includes(kw)).join('|')),
        recommendation: 'Remove instructions that bypass plan review, security veto, or governor enforcement.',
      })
    } else {
      const hasInjection = INJECTION_PHRASES.some((phrase) => lower.includes(phrase))
      if (hasInjection) {
        pushFinding(findings, {
          code: 'PROMPT_INJECTION_LANGUAGE',
          severity: 'warning',
          category: 'prompt_injection',
          title: 'Prompt injection language detected',
          message: `Potential prompt injection language found in ${f.path}.`,
          path: f.path,
          evidenceHash: sha256Hex(INJECTION_PHRASES.filter((p) => lower.includes(p)).join('|')),
          recommendation: 'Review this content; avoid instructions that attempt to override system rules.',
        })
      }
    }

    // Pipe-to-shell / exec hints (warning)
    for (const pattern of PIPE_TO_SHELL_PATTERNS) {
      if (!pattern.test(sample)) continue
      pushFinding(findings, {
        code: 'PIPE_TO_SHELL_LANGUAGE',
        severity: 'warning',
        category: 'templates',
        title: 'Risky execution instructions detected',
        message: `Risky execution hint found in ${f.path} (e.g., pipe-to-shell or chmod +x).`,
        path: f.path,
        evidenceHash: sha256Hex(pattern.source),
        recommendation: 'Avoid distributing instructions that encourage unsafe shell execution.',
      })
      break
    }
  }

  const summaryCounts = findings.reduce(
    (acc, f) => {
      acc[f.severity] += 1
      return acc
    },
    { info: 0, warning: 0, danger: 0 } as Record<ScanSeverity, number>
  )

  const outcome = summaryCounts.danger > 0 ? 'block' : summaryCounts.warning > 0 ? 'warn' : 'pass'

  return {
    outcome,
    blocked: outcome === 'block',
    summaryCounts,
    findings,
    scannerVersion: CLAWPACK_SCANNER_VERSION,
  }
}
