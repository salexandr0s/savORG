import 'server-only'

import { promises as fsp } from 'node:fs'
import { basename, dirname } from 'node:path'
import yaml from 'js-yaml'
import type { WorkflowConfig, WorkflowSelectionConfig } from '@clawcontrol/core'
import { validateWorkspacePath } from '@/lib/fs/path-policy'
import {
  formatAjvErrors,
  validateSelectionSchema,
  validateWorkflowSchema,
  validateWorkflowSemantics,
} from './validation'

const WORKSPACES_DIR = '/workflows'
const SELECTION_FILE = '/workflows/workflow-selection.yaml'
const RESOLVED_WORKFLOWS_FILE = '/workflows/clawcontrol-resolved-workflows.yaml'
const RESOLVED_SELECTION_FILE = '/workflows/clawcontrol-resolved-selection.yaml'

const RESERVED_WORKFLOW_FILE_NAMES = new Set([
  'workflow-selection.yaml',
  'workflow-selection.yml',
  'clawcontrol-resolved-workflows.yaml',
  'clawcontrol-resolved-selection.yaml',
])

export interface WorkspaceWorkflowFile {
  id: string
  fileName: string
  absolutePath: string
  workspacePath: string
  updatedAtMs: number
  size: number
}

export interface WorkspaceWorkflowConfigEntry {
  workflow: WorkflowConfig
  file: WorkspaceWorkflowFile
}

export interface WorkspaceSelectionOverlay {
  selection: WorkflowSelectionConfig
  absolutePath: string
  workspacePath: string
  updatedAtMs: number
  size: number
}

function ensureValidWorkflowSchema(workflow: unknown, source: string): WorkflowConfig {
  const valid = validateWorkflowSchema(workflow)
  if (!valid) {
    throw new Error(`Workflow YAML invalid (${source}): ${formatAjvErrors(validateWorkflowSchema.errors)}`)
  }

  const parsed = workflow as WorkflowConfig
  validateWorkflowSemantics(parsed, source)
  return parsed
}

function ensureValidSelectionSchema(selection: unknown, source: string): WorkflowSelectionConfig {
  const valid = validateSelectionSchema(selection)
  if (!valid) {
    throw new Error(`Workflow selection YAML invalid (${source}): ${formatAjvErrors(validateSelectionSchema.errors)}`)
  }

  return selection as WorkflowSelectionConfig
}

function normalizeYamlString(content: string): string {
  return content.endsWith('\n') ? content : `${content}\n`
}

function toWorkflowIdFromFileName(fileName: string): string {
  return fileName.replace(/\.ya?ml$/i, '')
}

function workflowFileNameForId(workflowId: string): string {
  return `${workflowId}.yaml`
}

async function ensureWorkflowsDir(): Promise<string> {
  const result = validateWorkspacePath(WORKSPACES_DIR)
  if (!result.valid || !result.resolvedPath) {
    throw new Error(result.error || `Invalid workspace workflows path: ${WORKSPACES_DIR}`)
  }

  await fsp.mkdir(result.resolvedPath, { recursive: true })
  return result.resolvedPath
}

async function statOrNull(path: string): Promise<Awaited<ReturnType<typeof fsp.stat>> | null> {
  try {
    return await fsp.stat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export function getWorkflowStoragePaths(): {
  workflowsDir: string
  selectionFile: string
  resolvedWorkflowsFile: string
  resolvedSelectionFile: string
} {
  return {
    workflowsDir: WORKSPACES_DIR,
    selectionFile: SELECTION_FILE,
    resolvedWorkflowsFile: RESOLVED_WORKFLOWS_FILE,
    resolvedSelectionFile: RESOLVED_SELECTION_FILE,
  }
}

export function isReservedWorkflowFileName(fileName: string): boolean {
  return RESERVED_WORKFLOW_FILE_NAMES.has(fileName.toLowerCase())
}

export async function listWorkspaceWorkflowFiles(): Promise<WorkspaceWorkflowFile[]> {
  const absoluteDir = await ensureWorkflowsDir()
  const entries = await fsp.readdir(absoluteDir, { withFileTypes: true })

  const files: WorkspaceWorkflowFile[] = []

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!entry.name.match(/\.ya?ml$/i)) continue
    if (isReservedWorkflowFileName(entry.name)) continue

    const workspacePath = `${WORKSPACES_DIR}/${entry.name}`
    const pathResult = validateWorkspacePath(workspacePath)
    if (!pathResult.valid || !pathResult.resolvedPath) continue

    const st = await fsp.stat(pathResult.resolvedPath)
    files.push({
      id: toWorkflowIdFromFileName(entry.name),
      fileName: entry.name,
      absolutePath: pathResult.resolvedPath,
      workspacePath,
      updatedAtMs: Number(st.mtimeMs),
      size: Number(st.size),
    })
  }

  files.sort((left, right) => left.fileName.localeCompare(right.fileName))
  return files
}

export async function loadWorkspaceWorkflowConfigs(): Promise<WorkspaceWorkflowConfigEntry[]> {
  const files = await listWorkspaceWorkflowFiles()
  const out: WorkspaceWorkflowConfigEntry[] = []

  for (const file of files) {
    const raw = await fsp.readFile(file.absolutePath, 'utf8')
    const parsed = yaml.load(raw)
    const workflow = ensureValidWorkflowSchema(parsed, file.workspacePath)
    out.push({ workflow, file })
  }

  return out
}

export async function readWorkspaceWorkflowConfigById(workflowId: string): Promise<WorkflowConfig | null> {
  const filePath = `${WORKSPACES_DIR}/${workflowFileNameForId(workflowId)}`
  const result = validateWorkspacePath(filePath)
  if (!result.valid || !result.resolvedPath) {
    throw new Error(result.error || `Invalid workflow path: ${filePath}`)
  }

  try {
    const raw = await fsp.readFile(result.resolvedPath, 'utf8')
    const parsed = yaml.load(raw)
    return ensureValidWorkflowSchema(parsed, filePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function writeWorkspaceWorkflowConfig(workflow: WorkflowConfig): Promise<{
  absolutePath: string
  workspacePath: string
}> {
  ensureValidWorkflowSchema(workflow, workflow.id)

  const workspacePath = `${WORKSPACES_DIR}/${workflowFileNameForId(workflow.id)}`
  const result = validateWorkspacePath(workspacePath)
  if (!result.valid || !result.resolvedPath) {
    throw new Error(result.error || `Invalid workflow path: ${workspacePath}`)
  }

  await fsp.mkdir(dirname(result.resolvedPath), { recursive: true })
  const dumped = yaml.dump(workflow, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  })
  await fsp.writeFile(result.resolvedPath, normalizeYamlString(dumped), 'utf8')

  return {
    absolutePath: result.resolvedPath,
    workspacePath,
  }
}

export async function deleteWorkspaceWorkflowConfig(workflowId: string): Promise<boolean> {
  const workspacePath = `${WORKSPACES_DIR}/${workflowFileNameForId(workflowId)}`
  const result = validateWorkspacePath(workspacePath)
  if (!result.valid || !result.resolvedPath) {
    throw new Error(result.error || `Invalid workflow path: ${workspacePath}`)
  }

  try {
    await fsp.unlink(result.resolvedPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function readWorkspaceSelectionOverlay(): Promise<WorkspaceSelectionOverlay | null> {
  const result = validateWorkspacePath(SELECTION_FILE)
  if (!result.valid || !result.resolvedPath) {
    throw new Error(result.error || `Invalid workflow selection path: ${SELECTION_FILE}`)
  }

  const st = await statOrNull(result.resolvedPath)
  if (!st) return null

  const raw = await fsp.readFile(result.resolvedPath, 'utf8')
  const parsed = yaml.load(raw)
  const selection = ensureValidSelectionSchema(parsed, SELECTION_FILE)

  return {
    selection,
    absolutePath: result.resolvedPath,
    workspacePath: SELECTION_FILE,
    updatedAtMs: Number(st.mtimeMs),
    size: Number(st.size),
  }
}

export async function writeWorkspaceSelectionOverlay(selection: WorkflowSelectionConfig): Promise<void> {
  ensureValidSelectionSchema(selection, SELECTION_FILE)

  const result = validateWorkspacePath(SELECTION_FILE)
  if (!result.valid || !result.resolvedPath) {
    throw new Error(result.error || `Invalid workflow selection path: ${SELECTION_FILE}`)
  }

  await fsp.mkdir(dirname(result.resolvedPath), { recursive: true })
  const dumped = yaml.dump(selection, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  })
  await fsp.writeFile(result.resolvedPath, normalizeYamlString(dumped), 'utf8')
}

export async function deleteWorkspaceSelectionOverlay(): Promise<boolean> {
  const result = validateWorkspacePath(SELECTION_FILE)
  if (!result.valid || !result.resolvedPath) {
    throw new Error(result.error || `Invalid workflow selection path: ${SELECTION_FILE}`)
  }

  try {
    await fsp.unlink(result.resolvedPath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export async function writeResolvedWorkflowSnapshots(input: {
  workflows: WorkflowConfig[]
  selection: WorkflowSelectionConfig
  selectionSource: 'built_in' | 'custom'
}): Promise<void> {
  await ensureWorkflowsDir()

  const generatedAt = new Date().toISOString()

  const workflowsSnapshot = {
    generatedAt,
    source: 'clawcontrol',
    workflowCount: input.workflows.length,
    workflows: input.workflows,
  }

  const selectionSnapshot = {
    generatedAt,
    source: 'clawcontrol',
    selectionSource: input.selectionSource,
    defaultWorkflowId: input.selection.defaultWorkflowId,
    rules: input.selection.rules,
  }

  const workflowsResult = validateWorkspacePath(RESOLVED_WORKFLOWS_FILE)
  if (!workflowsResult.valid || !workflowsResult.resolvedPath) {
    throw new Error(workflowsResult.error || `Invalid workflow snapshot path: ${RESOLVED_WORKFLOWS_FILE}`)
  }

  const selectionResult = validateWorkspacePath(RESOLVED_SELECTION_FILE)
  if (!selectionResult.valid || !selectionResult.resolvedPath) {
    throw new Error(selectionResult.error || `Invalid selection snapshot path: ${RESOLVED_SELECTION_FILE}`)
  }

  await fsp.mkdir(dirname(workflowsResult.resolvedPath), { recursive: true })

  const workflowDump = yaml.dump(workflowsSnapshot, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  })

  const selectionDump = yaml.dump(selectionSnapshot, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  })

  await Promise.all([
    fsp.writeFile(workflowsResult.resolvedPath, normalizeYamlString(workflowDump), 'utf8'),
    fsp.writeFile(selectionResult.resolvedPath, normalizeYamlString(selectionDump), 'utf8'),
  ])
}

export function workspaceWorkflowFileName(workspacePath: string): string {
  return basename(workspacePath)
}
