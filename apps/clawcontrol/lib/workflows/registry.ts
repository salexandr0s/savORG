import 'server-only'

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type {
  WorkflowConfig,
  WorkflowSelectionConfig,
  WorkflowSelectionRule,
} from '@clawcontrol/core'
import { getWorkspaceRoot } from '@/lib/fs/path-policy'
import {
  formatAjvErrors,
  orderSelectionRulesByPrecedence,
  validateSelectionSchema,
  validateSelectionSemantics,
  validateWorkflowSchema,
  validateWorkflowSemantics,
} from './validation'
import {
  loadWorkspaceWorkflowConfigs,
  readWorkspaceSelectionOverlay,
  writeResolvedWorkflowSnapshots,
} from './storage'

const WORKFLOW_CONFIG_DIR = 'workflows'
const WORKFLOW_SELECTION_FILE = 'workflow-selection.yaml'
const CACHE_TTL_MS = 30_000

interface BuiltInWorkflowFile {
  absolutePath: string
  sourcePath: string
  updatedAtMs: number
  size: number
}

export interface WorkflowSelectionInput {
  requestedWorkflowId?: string | null
  priority?: string | null
  tags?: string[] | null
  title?: string | null
  goalMd?: string | null
}

export interface WorkflowSelectionResult {
  workflowId: string
  reason: 'explicit' | 'rule' | 'default'
  matchedRuleId: string | null
}

export type WorkflowSource = 'built_in' | 'custom'

export interface WorkflowDefinitionRecord {
  id: string
  source: WorkflowSource
  sourcePath: string
  updatedAt: string
  editable: boolean
  stages: number
  loops: number
  workflow: WorkflowConfig
}

export interface WorkflowRegistrySnapshot {
  workflows: WorkflowConfig[]
  selection: WorkflowSelectionConfig
  selectionSource: WorkflowSource
  definitions: WorkflowDefinitionRecord[]
  loadedAt: string
}

interface RegistryCache {
  builtInRoot: string
  workspaceRoot: string
  versionKey: string
  loadedAtMs: number
  workflows: WorkflowConfig[]
  workflowsById: Map<string, WorkflowConfig>
  definitions: WorkflowDefinitionRecord[]
  definitionsById: Map<string, WorkflowDefinitionRecord>
  selection: WorkflowSelectionConfig
  selectionSource: WorkflowSource
}

let cache: RegistryCache | null = null

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function normalizeTags(tags: string[] | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const tag of tags ?? []) {
    const normalized = normalizeText(tag)
    if (!normalized) continue
    out.add(normalized)
  }
  return out
}

function wordMatch(text: string, keywords: string[] | undefined): boolean {
  if (!keywords || keywords.length === 0) return true
  const normalizedText = normalizeText(text)
  if (!normalizedText) return false

  for (const rawKeyword of keywords) {
    const keyword = normalizeText(rawKeyword)
    if (!keyword) continue
    if (normalizedText.includes(keyword)) return true
  }

  return false
}

function overlapMatch(tagSet: Set<string>, tagsAny: string[] | undefined): boolean {
  if (!tagsAny || tagsAny.length === 0) return true
  if (tagSet.size === 0) return false

  for (const rawTag of tagsAny) {
    const tag = normalizeText(rawTag)
    if (!tag) continue
    if (tagSet.has(tag)) return true
  }

  return false
}

function matchRule(input: WorkflowSelectionInput, rule: WorkflowSelectionRule): boolean {
  const normalizedPriority = normalizeText(input.priority)
  if (rule.priority && rule.priority.length > 0) {
    const allowed = new Set(rule.priority.map((value) => value.toUpperCase()))
    if (!allowed.has(normalizedPriority.toUpperCase())) return false
  }

  const tags = normalizeTags(input.tags)
  if (!overlapMatch(tags, rule.tagsAny)) return false
  if (!wordMatch(input.title ?? '', rule.titleKeywordsAny)) return false
  if (!wordMatch(input.goalMd ?? '', rule.goalKeywordsAny)) return false
  return true
}

async function fileVersion(path: string): Promise<string> {
  const info = await stat(path)
  return `${path}:${info.mtimeMs}:${info.size}`
}

async function resolveBuiltInConfigRoot(): Promise<string> {
  const candidates = [
    join(process.cwd(), 'config'),
    join(process.cwd(), 'apps', 'clawcontrol', 'config'),
  ]

  for (const root of candidates) {
    try {
      const workflowDir = join(root, WORKFLOW_CONFIG_DIR)
      await stat(workflowDir)
      await stat(join(root, WORKFLOW_SELECTION_FILE))
      return root
    } catch {
      // Continue scanning.
    }
  }

  throw new Error('Workflow config directory not found')
}

async function listBuiltInWorkflowFiles(root: string): Promise<BuiltInWorkflowFile[]> {
  const workflowDir = join(root, WORKFLOW_CONFIG_DIR)
  const entries = await readdir(workflowDir, { withFileTypes: true })

  const files: BuiltInWorkflowFile[] = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.match(/\.ya?ml$/i)) continue

    const absolutePath = join(workflowDir, entry.name)
    const st = await stat(absolutePath)
    files.push({
      absolutePath,
      sourcePath: `config/workflows/${entry.name}`,
      updatedAtMs: st.mtimeMs,
      size: st.size,
    })
  }

  files.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath))
  return files
}

async function parseWorkflowFromFile(path: string, sourcePath: string): Promise<WorkflowConfig> {
  const raw = await readFile(path, 'utf8')
  const parsed = yaml.load(raw)

  const valid = validateWorkflowSchema(parsed)
  if (!valid) {
    throw new Error(`Workflow YAML invalid (${sourcePath}): ${formatAjvErrors(validateWorkflowSchema.errors)}`)
  }

  const workflow = parsed as WorkflowConfig
  validateWorkflowSemantics(workflow, sourcePath)
  return workflow
}

async function parseSelectionFromFile(path: string, sourcePath: string): Promise<WorkflowSelectionConfig> {
  const raw = await readFile(path, 'utf8')
  const parsed = yaml.load(raw)

  const valid = validateSelectionSchema(parsed)
  if (!valid) {
    throw new Error(
      `Workflow selection YAML invalid (${sourcePath}): ${formatAjvErrors(validateSelectionSchema.errors)}`
    )
  }

  return parsed as WorkflowSelectionConfig
}

function countLoopStages(workflow: WorkflowConfig): number {
  return workflow.stages.filter((stage) => stage.type === 'loop').length
}

async function buildRegistry(builtInRoot: string, versionKey: string): Promise<RegistryCache> {
  const definitions: WorkflowDefinitionRecord[] = []
  const definitionsById = new Map<string, WorkflowDefinitionRecord>()
  const workflowsById = new Map<string, WorkflowConfig>()

  const builtInFiles = await listBuiltInWorkflowFiles(builtInRoot)
  for (const file of builtInFiles) {
    const workflow = await parseWorkflowFromFile(file.absolutePath, file.sourcePath)
    if (definitionsById.has(workflow.id)) {
      const existing = definitionsById.get(workflow.id) as WorkflowDefinitionRecord
      throw new Error(
        `Duplicate workflow id "${workflow.id}" in ${file.sourcePath}; already defined in ${existing.sourcePath}`
      )
    }

    const record: WorkflowDefinitionRecord = {
      id: workflow.id,
      source: 'built_in',
      sourcePath: file.sourcePath,
      updatedAt: new Date(file.updatedAtMs).toISOString(),
      editable: false,
      stages: workflow.stages.length,
      loops: countLoopStages(workflow),
      workflow,
    }

    definitions.push(record)
    definitionsById.set(workflow.id, record)
    workflowsById.set(workflow.id, workflow)
  }

  const workspaceEntries = await loadWorkspaceWorkflowConfigs()
  for (const entry of workspaceEntries) {
    const workflow = entry.workflow
    if (definitionsById.has(workflow.id)) {
      const existing = definitionsById.get(workflow.id) as WorkflowDefinitionRecord
      throw new Error(
        `Duplicate workflow id "${workflow.id}" in ${entry.file.workspacePath}; already defined in ${existing.sourcePath}`
      )
    }

    const record: WorkflowDefinitionRecord = {
      id: workflow.id,
      source: 'custom',
      sourcePath: entry.file.workspacePath,
      updatedAt: new Date(entry.file.updatedAtMs).toISOString(),
      editable: true,
      stages: workflow.stages.length,
      loops: countLoopStages(workflow),
      workflow,
    }

    definitions.push(record)
    definitionsById.set(workflow.id, record)
    workflowsById.set(workflow.id, workflow)
  }

  if (workflowsById.size === 0) {
    throw new Error('No workflow YAML files found')
  }

  const builtInSelectionPath = join(builtInRoot, WORKFLOW_SELECTION_FILE)
  const builtInSelection = await parseSelectionFromFile(
    builtInSelectionPath,
    `config/${WORKFLOW_SELECTION_FILE}`
  )

  const selectionOverlay = await readWorkspaceSelectionOverlay()
  const rawSelection = selectionOverlay?.selection ?? builtInSelection
  const selectionSource: WorkflowSource = selectionOverlay ? 'custom' : 'built_in'

  validateSelectionSemantics(rawSelection, new Set(workflowsById.keys()))

  const selection: WorkflowSelectionConfig = {
    ...rawSelection,
    rules: orderSelectionRulesByPrecedence(rawSelection.rules),
  }

  const workflows = [...workflowsById.values()].sort((a, b) => a.id.localeCompare(b.id))
  definitions.sort((a, b) => a.id.localeCompare(b.id))

  return {
    builtInRoot,
    workspaceRoot: getWorkspaceRoot(),
    versionKey,
    loadedAtMs: Date.now(),
    workflows,
    workflowsById,
    definitions,
    definitionsById,
    selection,
    selectionSource,
  }
}

async function currentVersionKey(builtInRoot: string): Promise<string> {
  const builtInFiles = await listBuiltInWorkflowFiles(builtInRoot)
  const builtInVersions = await Promise.all(
    builtInFiles.map((file) => fileVersion(file.absolutePath))
  )

  const selectionPath = join(builtInRoot, WORKFLOW_SELECTION_FILE)
  const selectionVersion = await fileVersion(selectionPath)

  const workspaceEntries = await loadWorkspaceWorkflowConfigs()
  const workspaceVersions = workspaceEntries.map((entry) => {
    return `${entry.file.absolutePath}:${entry.file.updatedAtMs}:${entry.file.size}`
  })

  const overlay = await readWorkspaceSelectionOverlay()
  const overlayVersion = overlay
    ? `${overlay.absolutePath}:${overlay.updatedAtMs}:${overlay.size}`
    : 'overlay:none'

  return [...builtInVersions, selectionVersion, ...workspaceVersions, overlayVersion].sort().join('|')
}

async function loadRegistry(force = false): Promise<RegistryCache> {
  const builtInRoot = await resolveBuiltInConfigRoot()
  const workspaceRoot = getWorkspaceRoot()
  const now = Date.now()

  if (
    !force
    && cache
    && cache.builtInRoot === builtInRoot
    && cache.workspaceRoot === workspaceRoot
    && now - cache.loadedAtMs < CACHE_TTL_MS
  ) {
    return cache
  }

  const versionKey = await currentVersionKey(builtInRoot)
  if (
    !force
    && cache
    && cache.builtInRoot === builtInRoot
    && cache.workspaceRoot === workspaceRoot
    && cache.versionKey === versionKey
  ) {
    cache = {
      ...cache,
      loadedAtMs: now,
    }
    return cache
  }

  const next = await buildRegistry(builtInRoot, versionKey)
  cache = next
  return next
}

export async function listWorkflowConfigs(options?: {
  forceReload?: boolean
}): Promise<WorkflowConfig[]> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return registry.workflows
}

export async function listWorkflowDefinitions(options?: {
  forceReload?: boolean
}): Promise<WorkflowDefinitionRecord[]> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return registry.definitions
}

export async function getWorkflowConfig(
  workflowId: string,
  options?: { forceReload?: boolean }
): Promise<WorkflowConfig | null> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return registry.workflowsById.get(workflowId) ?? null
}

export async function getWorkflowDefinition(
  workflowId: string,
  options?: { forceReload?: boolean }
): Promise<WorkflowDefinitionRecord | null> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return registry.definitionsById.get(workflowId) ?? null
}

export async function getWorkflowSelectionConfig(options?: {
  forceReload?: boolean
}): Promise<WorkflowSelectionConfig> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return registry.selection
}

export async function getWorkflowRegistrySnapshot(options?: {
  forceReload?: boolean
}): Promise<WorkflowRegistrySnapshot> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return {
    workflows: registry.workflows,
    selection: registry.selection,
    selectionSource: registry.selectionSource,
    definitions: registry.definitions,
    loadedAt: new Date(registry.loadedAtMs).toISOString(),
  }
}

export async function selectWorkflowForWorkOrder(
  input: WorkflowSelectionInput,
  options?: { forceReload?: boolean }
): Promise<WorkflowSelectionResult> {
  const registry = await loadRegistry(Boolean(options?.forceReload))

  const requestedWorkflowId = normalizeText(input.requestedWorkflowId)
  if (requestedWorkflowId) {
    if (!registry.workflowsById.has(requestedWorkflowId)) {
      throw new Error(`Unknown requested workflow: ${requestedWorkflowId}`)
    }
    return {
      workflowId: requestedWorkflowId,
      reason: 'explicit',
      matchedRuleId: null,
    }
  }

  for (const rule of registry.selection.rules) {
    if (!matchRule(input, rule)) continue
    return {
      workflowId: rule.workflowId,
      reason: 'rule',
      matchedRuleId: rule.id,
    }
  }

  return {
    workflowId: registry.selection.defaultWorkflowId,
    reason: 'default',
    matchedRuleId: null,
  }
}

export async function isBuiltInWorkflow(
  workflowId: string,
  options?: { forceReload?: boolean }
): Promise<boolean> {
  const definition = await getWorkflowDefinition(workflowId, options)
  if (!definition) return false
  return definition.source === 'built_in'
}

export async function syncResolvedWorkflowSnapshots(options?: {
  forceReload?: boolean
}): Promise<{
  workflowCount: number
  selectionSource: WorkflowSource
}> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  await writeResolvedWorkflowSnapshots({
    workflows: registry.workflows,
    selection: registry.selection,
    selectionSource: registry.selectionSource,
  })

  return {
    workflowCount: registry.workflows.length,
    selectionSource: registry.selectionSource,
  }
}

export function clearWorkflowRegistryCache(): void {
  cache = null
}
