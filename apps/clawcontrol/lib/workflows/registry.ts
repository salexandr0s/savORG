import 'server-only'

import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import yaml from 'js-yaml'
import Ajv, { type ErrorObject } from 'ajv'
import {
  WORKFLOW_SCHEMA,
  WORKFLOW_SELECTION_SCHEMA,
  type WorkflowConfig,
  type WorkflowSelectionConfig,
  type WorkflowSelectionRule,
} from '@clawcontrol/core'

const WORKFLOW_CONFIG_DIR = 'workflows'
const WORKFLOW_SELECTION_FILE = 'workflow-selection.yaml'
const CACHE_TTL_MS = 30_000

const ajv = new Ajv({ allErrors: true })
const validateWorkflow = ajv.compile(WORKFLOW_SCHEMA)
const validateSelection = ajv.compile(WORKFLOW_SELECTION_SCHEMA)

interface RegistryCache {
  root: string
  loadedAtMs: number
  versionKey: string
  workflows: WorkflowConfig[]
  workflowsById: Map<string, WorkflowConfig>
  selection: WorkflowSelectionConfig
}

let cache: RegistryCache | null = null

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

export interface WorkflowRegistrySnapshot {
  workflows: WorkflowConfig[]
  selection: WorkflowSelectionConfig
  loadedAt: string
}

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

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return 'unknown validation error'
  return errors
    .map((error) => {
      const path = (error as { instancePath?: string; dataPath?: string }).instancePath
        || (error as { dataPath?: string }).dataPath
      const at = path ? ` at ${path}` : ''
      const msg = error.message ?? 'invalid value'
      return `${msg}${at}`
    })
    .join('; ')
}

async function fileVersion(path: string): Promise<string> {
  const info = await stat(path)
  return `${path}:${info.mtimeMs}:${info.size}`
}

async function resolveConfigRoot(): Promise<string> {
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
      // keep scanning
    }
  }

  throw new Error('Workflow config directory not found')
}

async function listWorkflowFiles(root: string): Promise<string[]> {
  const workflowDir = join(root, WORKFLOW_CONFIG_DIR)
  const entries = await readdir(workflowDir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')))
    .map((entry) => join(workflowDir, entry.name))
    .sort((a, b) => a.localeCompare(b))
}

async function readYamlObject(path: string): Promise<unknown> {
  const raw = await readFile(path, 'utf8')
  return yaml.load(raw)
}

function validateWorkflowSemantics(workflow: WorkflowConfig, source: string): void {
  const stageRefs = new Set<string>()
  for (const stage of workflow.stages) {
    if (stageRefs.has(stage.ref)) {
      throw new Error(`Workflow ${workflow.id} has duplicate stage ref "${stage.ref}" in ${source}`)
    }
    stageRefs.add(stage.ref)
  }

  for (const stage of workflow.stages) {
    if (stage.type === 'loop' && !stage.loop) {
      throw new Error(`Workflow ${workflow.id} stage "${stage.ref}" is loop type but missing loop config`)
    }
    if (stage.type !== 'loop' && stage.loop) {
      throw new Error(`Workflow ${workflow.id} stage "${stage.ref}" defines loop config but is not loop type`)
    }

    if (stage.loopTarget && !stageRefs.has(stage.loopTarget)) {
      throw new Error(
        `Workflow ${workflow.id} stage "${stage.ref}" loopTarget "${stage.loopTarget}" not found`
      )
    }

    if (stage.loop?.verifyStageRef && !stageRefs.has(stage.loop.verifyStageRef)) {
      throw new Error(
        `Workflow ${workflow.id} stage "${stage.ref}" verifyStageRef "${stage.loop.verifyStageRef}" not found`
      )
    }
  }
}

function validateSelectionSemantics(
  selection: WorkflowSelectionConfig,
  workflowIds: Set<string>
): void {
  if (!workflowIds.has(selection.defaultWorkflowId)) {
    throw new Error(`Default workflow "${selection.defaultWorkflowId}" is not defined`)
  }

  const ruleIds = new Set<string>()
  const declaredPrecedence = new Map<string, string[]>()
  for (const rule of selection.rules) {
    if (ruleIds.has(rule.id)) {
      throw new Error(`Duplicate workflow selection rule id: ${rule.id}`)
    }
    ruleIds.add(rule.id)
    declaredPrecedence.set(rule.id, rule.precedes ?? [])

    if (!workflowIds.has(rule.workflowId)) {
      throw new Error(
        `Workflow selection rule "${rule.id}" references unknown workflow "${rule.workflowId}"`
      )
    }
  }

  for (const [ruleId, targets] of declaredPrecedence.entries()) {
    for (const targetRuleId of targets) {
      if (!ruleIds.has(targetRuleId)) {
        throw new Error(
          `Workflow selection rule "${ruleId}" precedes unknown rule "${targetRuleId}"`
        )
      }
      if (targetRuleId === ruleId) {
        throw new Error(`Workflow selection rule "${ruleId}" cannot precede itself`)
      }
    }
  }
}

function orderSelectionRulesByPrecedence(rules: WorkflowSelectionRule[]): WorkflowSelectionRule[] {
  const ruleById = new Map<string, WorkflowSelectionRule>()
  const originalIndex = new Map<string, number>()
  const outgoing = new Map<string, Set<string>>()
  const indegree = new Map<string, number>()

  for (let index = 0; index < rules.length; index++) {
    const rule = rules[index]
    ruleById.set(rule.id, rule)
    originalIndex.set(rule.id, index)
    outgoing.set(rule.id, new Set())
    indegree.set(rule.id, 0)
  }

  for (const rule of rules) {
    const from = rule.id
    for (const target of rule.precedes ?? []) {
      const edges = outgoing.get(from)
      if (!edges) continue
      if (edges.has(target)) continue
      edges.add(target)
      indegree.set(target, (indegree.get(target) ?? 0) + 1)
    }
  }

  const zero: string[] = []
  for (const [ruleId, degree] of indegree.entries()) {
    if (degree === 0) zero.push(ruleId)
  }

  zero.sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0))

  const orderedIds: string[] = []
  while (zero.length > 0) {
    const nextId = zero.shift() as string
    orderedIds.push(nextId)

    const targets = outgoing.get(nextId)
    if (!targets) continue
    for (const targetId of targets) {
      const remaining = (indegree.get(targetId) ?? 0) - 1
      indegree.set(targetId, remaining)
      if (remaining === 0) {
        zero.push(targetId)
      }
    }
    zero.sort((a, b) => (originalIndex.get(a) ?? 0) - (originalIndex.get(b) ?? 0))
  }

  if (orderedIds.length !== rules.length) {
    const unresolved = rules
      .map((rule) => rule.id)
      .filter((ruleId) => !orderedIds.includes(ruleId))
    throw new Error(
      `Workflow selection precedence contains a cycle among: ${unresolved.join(', ')}`
    )
  }

  return orderedIds.map((ruleId) => ruleById.get(ruleId) as WorkflowSelectionRule)
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

async function buildRegistry(root: string): Promise<RegistryCache> {
  const workflowFiles = await listWorkflowFiles(root)
  if (workflowFiles.length === 0) {
    throw new Error('No workflow YAML files found')
  }

  const workflows: WorkflowConfig[] = []
  const workflowsById = new Map<string, WorkflowConfig>()

  for (const path of workflowFiles) {
    const raw = await readYamlObject(path)
    const valid = validateWorkflow(raw)
    if (!valid) {
      throw new Error(`Workflow YAML invalid (${path}): ${formatAjvErrors(validateWorkflow.errors)}`)
    }

    const workflow = raw as WorkflowConfig
    validateWorkflowSemantics(workflow, path)

    if (workflowsById.has(workflow.id)) {
      throw new Error(`Duplicate workflow id "${workflow.id}" found in ${path}`)
    }

    workflows.push(workflow)
    workflowsById.set(workflow.id, workflow)
  }

  const selectionPath = join(root, WORKFLOW_SELECTION_FILE)
  const rawSelection = await readYamlObject(selectionPath)
  const selectionValid = validateSelection(rawSelection)
  if (!selectionValid) {
    throw new Error(
      `Workflow selection YAML invalid (${selectionPath}): ${formatAjvErrors(validateSelection.errors)}`
    )
  }

  const rawSelectionConfig = rawSelection as WorkflowSelectionConfig
  validateSelectionSemantics(rawSelectionConfig, new Set(workflowsById.keys()))

  const selection: WorkflowSelectionConfig = {
    ...rawSelectionConfig,
    rules: orderSelectionRulesByPrecedence(rawSelectionConfig.rules),
  }

  const versions = await Promise.all(
    [...workflowFiles, selectionPath].map((file) => fileVersion(file))
  )

  return {
    root,
    loadedAtMs: Date.now(),
    versionKey: versions.sort().join('|'),
    workflows: workflows.sort((a, b) => a.id.localeCompare(b.id)),
    workflowsById,
    selection,
  }
}

async function loadRegistry(force = false): Promise<RegistryCache> {
  const root = await resolveConfigRoot()
  const selectionPath = join(root, WORKFLOW_SELECTION_FILE)
  const workflowFiles = await listWorkflowFiles(root)
  const currentVersions = await Promise.all(
    [...workflowFiles, selectionPath].map((file) => fileVersion(file))
  )
  const currentVersionKey = currentVersions.sort().join('|')

  const cached = cache
  if (
    !force &&
    cached &&
    cached.root === root &&
    cached.versionKey === currentVersionKey &&
    Date.now() - cached.loadedAtMs < CACHE_TTL_MS
  ) {
    return cached
  }

  const next = await buildRegistry(root)
  cache = next
  return next
}

export async function listWorkflowConfigs(options?: {
  forceReload?: boolean
}): Promise<WorkflowConfig[]> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return registry.workflows
}

export async function getWorkflowConfig(
  workflowId: string,
  options?: { forceReload?: boolean }
): Promise<WorkflowConfig | null> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return registry.workflowsById.get(workflowId) ?? null
}

export async function getWorkflowRegistrySnapshot(options?: {
  forceReload?: boolean
}): Promise<WorkflowRegistrySnapshot> {
  const registry = await loadRegistry(Boolean(options?.forceReload))
  return {
    workflows: registry.workflows,
    selection: registry.selection,
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

export function clearWorkflowRegistryCache(): void {
  cache = null
}
