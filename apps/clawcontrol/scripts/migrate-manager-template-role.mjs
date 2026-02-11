#!/usr/bin/env node

import { promises as fsp } from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const args = {
    apply: false,
    workspace: null,
  }

  for (const raw of argv) {
    if (raw === '--apply') {
      args.apply = true
      continue
    }
    if (raw === '--dry-run') {
      args.apply = false
      continue
    }
    if (raw.startsWith('--workspace=')) {
      const value = raw.slice('--workspace='.length).trim()
      args.workspace = value || null
      continue
    }
    if (raw === '--help' || raw === '-h') {
      printHelp()
      process.exit(0)
    }
  }

  return args
}

function printHelp() {
  console.log(`migrate-manager-template-role

Usage:
  node scripts/migrate-manager-template-role.mjs [--dry-run] [--apply] [--workspace=/path]

Behavior:
  - Scans <workspace>/agent-templates/*/template.json
  - Finds templates with role=CUSTOM that look manager-like
  - In --dry-run mode (default), reports proposed changes only
  - In --apply mode, rewrites role from CUSTOM -> MANAGER
`)
}

async function fileExists(targetPath) {
  try {
    await fsp.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function resolveWorkspaceRoot(explicitWorkspace) {
  if (explicitWorkspace) return path.resolve(explicitWorkspace)

  const envCandidates = [
    process.env.CLAWCONTROL_WORKSPACE_ROOT,
    process.env.WORKSPACE_ROOT,
    process.env.OPENCLAW_WORKSPACE,
  ]
    .map((value) => value?.trim())
    .filter(Boolean)

  if (envCandidates.length > 0) {
    return path.resolve(envCandidates[0])
  }

  const settingsPath = process.env.CLAWCONTROL_SETTINGS_PATH?.trim()
  if (settingsPath) {
    try {
      const raw = await fsp.readFile(settingsPath, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed.workspacePath === 'string' && parsed.workspacePath.trim()) {
        return path.resolve(parsed.workspacePath)
      }
    } catch {
      // Ignore settings parse/read failures and fall back to cwd.
    }
  }

  return process.cwd()
}

function toKeywordText(value) {
  return String(value ?? '').toLowerCase()
}

function keywordMatch(text, keywords) {
  return keywords.filter((keyword) => text.includes(keyword))
}

function looksManagerLike(config, soulContent, overlayContent) {
  const strongKeywords = ['manager', 'orchestrator', 'orchestration']
  const weakKeywords = ['coordination', 'workflow engine', 'dispatch', 'router']

  const idText = toKeywordText(config.id)
  const nameText = toKeywordText(config.name)
  const descriptionText = toKeywordText(config.description)
  const tagText = Array.isArray(config.tags)
    ? toKeywordText(config.tags.join(' '))
    : ''
  const fileText = `${toKeywordText(soulContent)} ${toKeywordText(overlayContent)}`

  const reasons = []

  const idHits = keywordMatch(idText, strongKeywords)
  if (idHits.length > 0) reasons.push(`id:${idHits.join(',')}`)

  const nameHits = keywordMatch(nameText, strongKeywords)
  if (nameHits.length > 0) reasons.push(`name:${nameHits.join(',')}`)

  const descStrongHits = keywordMatch(descriptionText, strongKeywords)
  if (descStrongHits.length > 0) reasons.push(`description:${descStrongHits.join(',')}`)

  const tagHits = keywordMatch(tagText, [...strongKeywords, ...weakKeywords])
  if (tagHits.length > 0) reasons.push(`tags:${tagHits.join(',')}`)

  const fileStrongHits = keywordMatch(fileText, strongKeywords)
  if (fileStrongHits.length > 0) reasons.push(`files:${fileStrongHits.join(',')}`)

  const weakSignals =
    keywordMatch(descriptionText, weakKeywords).length +
    keywordMatch(fileText, weakKeywords).length
  if (weakSignals >= 2) reasons.push('weak-signals:dispatch/coordination')

  const matched = reasons.length > 0
  return { matched, reasons }
}

async function main() {
  const { apply, workspace } = parseArgs(process.argv.slice(2))
  const workspaceRoot = await resolveWorkspaceRoot(workspace)
  const templatesRoot = path.join(workspaceRoot, 'agent-templates')

  if (!(await fileExists(templatesRoot))) {
    console.log(`[migrate-manager-template-role] agent-templates directory not found: ${templatesRoot}`)
    console.log('Summary')
    console.log(`- workspace: ${workspaceRoot}`)
    console.log('- scanned templates: 0')
    console.log('- role=CUSTOM templates: 0')
    console.log('- manager-like candidates: 0')
    console.log('- migrated: 0')
    console.log(`- mode: ${apply ? 'apply' : 'dry-run'}`)
    return
  }

  const entries = await fsp.readdir(templatesRoot, { withFileTypes: true })
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b))

  let scanned = 0
  let customTemplates = 0
  let managerLike = 0
  let migrated = 0
  const skipped = []

  for (const dirName of dirs) {
    const baseDir = path.join(templatesRoot, dirName)
    const templateJsonPath = path.join(baseDir, 'template.json')
    if (!(await fileExists(templateJsonPath))) continue

    scanned += 1

    let parsed
    try {
      parsed = JSON.parse(await fsp.readFile(templateJsonPath, 'utf8'))
    } catch (error) {
      skipped.push(`${dirName}: invalid template.json (${error instanceof Error ? error.message : String(error)})`)
      continue
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      skipped.push(`${dirName}: invalid template.json shape`)
      continue
    }

    const config = parsed
    if (String(config.role) !== 'CUSTOM') continue
    customTemplates += 1

    const soulPath = path.join(baseDir, 'SOUL.md')
    const overlayPath = path.join(baseDir, 'overlay.md')
    const soulContent = (await fileExists(soulPath)) ? await fsp.readFile(soulPath, 'utf8') : ''
    const overlayContent = (await fileExists(overlayPath)) ? await fsp.readFile(overlayPath, 'utf8') : ''

    const check = looksManagerLike(config, soulContent, overlayContent)
    if (!check.matched) continue

    managerLike += 1
    const templateId = String(config.id ?? dirName)
    const reasonLabel = check.reasons.join(' | ')
    console.log(`[candidate] ${templateId} (${dirName}) -> MANAGER [${reasonLabel}]`)

    if (!apply) continue

    config.role = 'MANAGER'
    await fsp.writeFile(templateJsonPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    migrated += 1
    console.log(`[migrated] ${templateId} (${templateJsonPath})`)
  }

  console.log('\nSummary')
  console.log(`- workspace: ${workspaceRoot}`)
  console.log(`- scanned templates: ${scanned}`)
  console.log(`- role=CUSTOM templates: ${customTemplates}`)
  console.log(`- manager-like candidates: ${managerLike}`)
  console.log(`- migrated: ${migrated}`)
  console.log(`- mode: ${apply ? 'apply' : 'dry-run'}`)

  if (skipped.length > 0) {
    console.log('- skipped:')
    for (const item of skipped) {
      console.log(`  - ${item}`)
    }
  }
}

main().catch((error) => {
  console.error(`[migrate-manager-template-role] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
