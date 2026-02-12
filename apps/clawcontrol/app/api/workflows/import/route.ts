import { NextRequest, NextResponse } from 'next/server'
import yaml from 'js-yaml'
import { asAuthErrorResponse, verifyOperatorRequest } from '@/lib/auth/operator-auth'
import { enforceActionPolicy } from '@/lib/with-governor'
import {
  importCustomWorkflows,
  type WorkflowServiceError,
} from '@/lib/workflows/service'

interface ParsedImportPayload {
  workflows: unknown[]
  typedConfirmText?: string
}

function asWorkflowError(error: unknown): WorkflowServiceError | null {
  if (error instanceof Error && error.name === 'WorkflowServiceError') {
    return error as WorkflowServiceError
  }
  return null
}

function shouldIgnoreZipEntry(name: string): boolean {
  const normalized = name.replace(/\\/g, '/')
  if (normalized.startsWith('__MACOSX/')) return true
  const base = normalized.split('/').at(-1) ?? normalized
  if (base === '.DS_Store') return true
  return false
}

function isYamlPath(path: string): boolean {
  return /\.ya?ml$/i.test(path)
}

function isWorkflowCandidatePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.includes('workflow-selection')) return false
  if (normalized.includes('clawcontrol-resolved-')) return false
  if (normalized.endsWith('clawcontrol-package.yaml')) return false
  return isYamlPath(normalized)
}

async function parseWorkflowsFromZip(file: File): Promise<unknown[]> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await file.arrayBuffer())

  const entries = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .filter((entry) => !shouldIgnoreZipEntry(entry.name))
    .filter((entry) => isWorkflowCandidatePath(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))

  if (entries.length === 0) {
    throw new Error('No workflow YAML files found in ZIP archive')
  }

  const workflows: unknown[] = []
  for (const entry of entries) {
    const raw = await entry.async('string')
    const parsed = yaml.load(raw)
    workflows.push(parsed)
  }

  return workflows
}

async function parseWorkflowsFromFile(file: File): Promise<unknown[]> {
  const lowerName = file.name.toLowerCase()

  if (lowerName.endsWith('.zip')) {
    return parseWorkflowsFromZip(file)
  }

  if (!lowerName.endsWith('.yaml') && !lowerName.endsWith('.yml')) {
    throw new Error('Unsupported file type. Use .yaml, .yml, or .zip')
  }

  const raw = await file.text()
  const parsed = yaml.load(raw)

  if (Array.isArray(parsed)) {
    return parsed
  }

  return [parsed]
}

async function parseImportPayload(request: NextRequest): Promise<ParsedImportPayload> {
  const contentType = (request.headers.get('content-type') || '').toLowerCase()

  if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      throw new Error('Missing file for workflow import')
    }

    const typedConfirmText = typeof formData.get('typedConfirmText') === 'string'
      ? String(formData.get('typedConfirmText'))
      : undefined

    const workflows = await parseWorkflowsFromFile(file)
    return {
      workflows,
      typedConfirmText,
    }
  }

  const body = (await request.json().catch(() => null)) as {
    workflow?: unknown
    workflows?: unknown[]
    yaml?: string
    typedConfirmText?: string
  } | null

  if (!body) {
    throw new Error('Invalid request body')
  }

  if (Array.isArray(body.workflows) && body.workflows.length > 0) {
    return {
      workflows: body.workflows,
      typedConfirmText: body.typedConfirmText,
    }
  }

  if (body.workflow !== undefined) {
    return {
      workflows: [body.workflow],
      typedConfirmText: body.typedConfirmText,
    }
  }

  if (typeof body.yaml === 'string' && body.yaml.trim().length > 0) {
    const parsed = yaml.load(body.yaml)
    return {
      workflows: Array.isArray(parsed) ? parsed : [parsed],
      typedConfirmText: body.typedConfirmText,
    }
  }

  throw new Error('No workflow payload provided')
}

/**
 * POST /api/workflows/import
 * Import custom workflow YAML definitions
 */
export async function POST(request: NextRequest) {
  const auth = verifyOperatorRequest(request, { requireCsrf: true })
  if (!auth.ok) {
    return NextResponse.json(asAuthErrorResponse(auth), { status: auth.status })
  }

  let parsed: ParsedImportPayload
  try {
    parsed = await parseImportPayload(request)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid import payload' },
      { status: 400 }
    )
  }

  const enforcement = await enforceActionPolicy({
    actionKind: 'workflow.import',
    typedConfirmText: parsed.typedConfirmText,
  })

  if (!enforcement.allowed) {
    return NextResponse.json(
      {
        error: enforcement.errorType,
        policy: enforcement.policy,
      },
      { status: enforcement.status ?? 403 }
    )
  }

  try {
    const result = await importCustomWorkflows(parsed.workflows)

    return NextResponse.json({
      data: {
        imported: result.imported,
        importedIds: result.imported.map((item) => item.id),
        count: result.imported.length,
      },
    }, { status: 201 })
  } catch (error) {
    const workflowError = asWorkflowError(error)
    if (workflowError) {
      return NextResponse.json(
        {
          error: workflowError.message,
          code: workflowError.code,
          details: workflowError.details,
        },
        { status: workflowError.status }
      )
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to import workflows' },
      { status: 500 }
    )
  }
}
