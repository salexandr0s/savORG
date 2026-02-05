import { NextRequest, NextResponse } from 'next/server'
import { runCommandJson, runDynamicCommandJson } from '@clawcontrol/adapters-openclaw'

const DISPATCH_CRON_NAME = 'manager-dispatch-loop'
const DISPATCH_CRON_LEGACY_NAMES = new Set([DISPATCH_CRON_NAME, 'manager-dispatch'])

const DISPATCH_DEFAULT_EVERY = '20m'
const DISPATCH_AGENT_ID_CANDIDATES = ['savorgmanager', 'clawcontrolmanager']
const DISPATCH_SESSION_TARGET = 'isolated'
const DISPATCH_WAKE_MODE = 'next-heartbeat'
const DISPATCH_MESSAGE = 'Run dispatch loop: check planned queue and assign to available agents.'
const DISPATCH_DESCRIPTION =
  'Dispatch planned work orders to available specialists (serialized by dispatch lock).'

interface CronJobListItem {
  id: string
  name: string
  enabled?: boolean
  schedule?: {
    kind?: string
    everyMs?: number
    expr?: string
    atMs?: number
  }
}

interface OpenClawAgentConfig {
  id: string
}

interface DispatchCronStatus {
  available: boolean
  exists: boolean
  enabled: boolean
  jobId: string | null
  name: string
  schedule: string | null
  recommendedEvery: string
  overlapGuard: boolean
  duplicateJobIds: string[]
  error?: string
}

interface SetDispatchCronBody {
  enabled?: boolean
}

function parseJobs(data: unknown): CronJobListItem[] {
  if (Array.isArray(data)) return data as CronJobListItem[]
  if (data && typeof data === 'object' && Array.isArray((data as { jobs?: unknown }).jobs)) {
    return (data as { jobs: CronJobListItem[] }).jobs
  }
  return []
}

function isDispatchCron(job: CronJobListItem): boolean {
  return DISPATCH_CRON_LEGACY_NAMES.has(job.name)
}

function formatSchedule(job: CronJobListItem): string | null {
  const schedule = job.schedule
  if (!schedule) return null
  if (schedule.kind === 'every' && typeof schedule.everyMs === 'number') {
    const minutes = Math.round(schedule.everyMs / 60000)
    if (minutes > 0) return `every ${minutes}m`
  }
  if (schedule.kind === 'cron' && schedule.expr) return schedule.expr
  if (schedule.kind === 'at' && typeof schedule.atMs === 'number') {
    return `at ${new Date(schedule.atMs).toISOString()}`
  }
  return schedule.kind ?? null
}

async function loadDispatchJobs(): Promise<
  | { ok: true; all: CronJobListItem[]; dispatch: CronJobListItem[] }
  | { ok: false; error: string }
> {
  const jobsRes = await runCommandJson<unknown>('cron.jobs.json', { timeout: 45_000 })
  if (jobsRes.error) {
    return { ok: false, error: jobsRes.error }
  }

  const all = parseJobs(jobsRes.data)
  const dispatch = all.filter(isDispatchCron)
  return { ok: true, all, dispatch }
}

function statusFromDispatchJobs(
  jobs: CronJobListItem[],
  error?: string
): DispatchCronStatus {
  const primary = jobs.find((j) => j.name === DISPATCH_CRON_NAME) ?? jobs[0] ?? null

  return {
    available: !error,
    exists: Boolean(primary),
    enabled: Boolean(primary?.enabled),
    jobId: primary?.id ?? null,
    name: primary?.name ?? DISPATCH_CRON_NAME,
    schedule: primary ? formatSchedule(primary) : null,
    recommendedEvery: DISPATCH_DEFAULT_EVERY,
    overlapGuard: true,
    duplicateJobIds: jobs.slice(primary ? 1 : 0).map((j) => j.id),
    ...(error ? { error } : {}),
  }
}

async function ensureDispatchCronExists(enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const dispatchAgentId = await resolveDispatchAgentId()

  const createRes = await runDynamicCommandJson<unknown>('cron.add.agent', {
    name: DISPATCH_CRON_NAME,
    every: DISPATCH_DEFAULT_EVERY,
    agent: dispatchAgentId,
    session: DISPATCH_SESSION_TARGET,
    wake: DISPATCH_WAKE_MODE,
    message: DISPATCH_MESSAGE,
    description: DISPATCH_DESCRIPTION,
    disabled: enabled ? 'false' : 'true',
  }, {
    timeout: 60_000,
  })

  if (createRes.error) {
    return { ok: false, error: createRes.error }
  }

  return { ok: true }
}

async function resolveDispatchAgentId(): Promise<string> {
  const agentsRes = await runCommandJson<unknown>('config.agents.list.json', { timeout: 30_000 })
  if (agentsRes.error) return DISPATCH_AGENT_ID_CANDIDATES[0]

  const agents = Array.isArray(agentsRes.data) ? (agentsRes.data as OpenClawAgentConfig[]) : []
  const ids = new Set(agents.map((agent) => agent.id))

  for (const candidate of DISPATCH_AGENT_ID_CANDIDATES) {
    if (ids.has(candidate)) return candidate
  }

  // Fall back to first candidate; caller will surface create error if agent is invalid.
  return DISPATCH_AGENT_ID_CANDIDATES[0]
}

async function setJobEnabled(jobId: string, enabled: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  const action = enabled ? 'cron.enable' : 'cron.disable'
  const res = await runDynamicCommandJson<unknown>(action, { id: jobId }, { timeout: 45_000 })
  if (res.error) return { ok: false, error: res.error }
  return { ok: true }
}

/**
 * GET /api/dispatch/cron
 *
 * Returns the status of the manager dispatch cron job.
 */
export async function GET() {
  const jobs = await loadDispatchJobs()
  if (!jobs.ok) {
    return NextResponse.json({ data: statusFromDispatchJobs([], jobs.error) })
  }

  return NextResponse.json({ data: statusFromDispatchJobs(jobs.dispatch) })
}

/**
 * POST /api/dispatch/cron
 *
 * Body: { enabled: boolean }
 * Enables/disables the manager dispatch cron job.
 */
export async function POST(request: NextRequest) {
  let body: SetDispatchCronBody
  try {
    body = (await request.json()) as SetDispatchCronBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Missing required boolean field: enabled' }, { status: 400 })
  }

  const jobsBefore = await loadDispatchJobs()
  if (!jobsBefore.ok) {
    return NextResponse.json(
      { error: jobsBefore.error, code: 'OPENCLAW_CRON_UNAVAILABLE' },
      { status: 503 }
    )
  }

  let dispatchJobs = jobsBefore.dispatch

  if (dispatchJobs.length === 0) {
    const create = await ensureDispatchCronExists(body.enabled)
    if (!create.ok) {
      return NextResponse.json(
        { error: create.error, code: 'OPENCLAW_CRON_CREATE_FAILED' },
        { status: 502 }
      )
    }

    const afterCreate = await loadDispatchJobs()
    if (!afterCreate.ok) {
      return NextResponse.json(
        { error: afterCreate.error, code: 'OPENCLAW_CRON_UNAVAILABLE' },
        { status: 503 }
      )
    }
    dispatchJobs = afterCreate.dispatch
  }

  const primary = dispatchJobs.find((j) => j.name === DISPATCH_CRON_NAME) ?? dispatchJobs[0]
  if (!primary) {
    return NextResponse.json(
      { error: 'Dispatch cron job missing after create attempt', code: 'OPENCLAW_CRON_NOT_FOUND' },
      { status: 502 }
    )
  }

  // Ensure primary state matches requested state.
  if (Boolean(primary.enabled) !== body.enabled) {
    const toggled = await setJobEnabled(primary.id, body.enabled)
    if (!toggled.ok) {
      return NextResponse.json(
        { error: toggled.error, code: 'OPENCLAW_CRON_TOGGLE_FAILED' },
        { status: 502 }
      )
    }
  }

  // Keep only one active dispatch cron to avoid overlapping dispatch triggers.
  for (const duplicate of dispatchJobs) {
    if (duplicate.id === primary.id) continue
    if (!duplicate.enabled) continue

    const disabled = await setJobEnabled(duplicate.id, false)
    if (!disabled.ok) {
      return NextResponse.json(
        { error: disabled.error, code: 'OPENCLAW_CRON_DUPLICATE_DISABLE_FAILED' },
        { status: 502 }
      )
    }
  }

  const jobsAfter = await loadDispatchJobs()
  if (!jobsAfter.ok) {
    return NextResponse.json({ data: statusFromDispatchJobs(dispatchJobs, jobsAfter.error) })
  }

  return NextResponse.json({ data: statusFromDispatchJobs(jobsAfter.dispatch) })
}
