# savORG Multi-Agent Implementation Prompt

> **Context:** This prompt implements the multi-agent orchestration system design from `savorg.config.yaml` and wires it into the existing SQLite/Prisma schema in `apps/mission-control/prisma/schema.prisma`.

---

## OBJECTIVE

Implement the Savorg multi-agent orchestration layer that:
1. **Executes workflow chains** (feature_request, ui_feature, etc.) with proper state tracking
2. **Enforces tool policies** per agent (Guard can't execute code, Build can)
3. **Manages Operation lifecycle** through SQLite with atomic status transitions
4. **Links OpenClaw sessions to Operations** via session key convention (`:op:<operationId>`)
5. **Routes escalations** properly (iteration cap → CEO, security veto → CEO)
6. **Tracks receipts** for every agent execution with command outputs

---

## PHASE 1: Schema Alignment

### 1.1 Verify Agent Seeding

The `Agent` model exists. Seed the database with agents from `savorg.config.yaml`:

```typescript
// apps/mission-control/prisma/seed.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const AGENTS = [
  {
    name: 'savorgguard',
    role: 'input_screener',
    station: 'screen',
    sessionKey: 'agent:savorgguard:main',
    wipLimit: 5,
    model: 'claude-haiku-4-5-20251001',
    capabilities: JSON.stringify({
      can_execute_code: false,
      can_modify_files: false,
      can_send_messages: false,
      can_quarantine: true,
    }),
  },
  {
    name: 'savorgceo',
    role: 'strategic_interface',
    station: 'strategic',
    sessionKey: 'agent:savorgceo:main',
    wipLimit: 3,
    model: 'claude-opus-4-5-20251101',
    capabilities: JSON.stringify({
      can_execute_code: false,
      can_modify_files: false,
      can_send_messages: true,
      can_delegate: true,
    }),
  },
  {
    name: 'savorgmanager',
    role: 'orchestrator',
    station: 'orchestration',
    sessionKey: 'agent:savorgmanager:main',
    wipLimit: 5,
    model: 'claude-sonnet-4-5-20250929',
    capabilities: JSON.stringify({
      can_execute_code: false,
      can_modify_files: false,
      can_delegate: true,
      state_tracking: true,
    }),
  },
  {
    name: 'savorgplan',
    role: 'planner',
    station: 'spec',
    sessionKey: 'agent:savorgplan:main',
    wipLimit: 3,
    model: 'claude-sonnet-4-5-20250929',
    capabilities: JSON.stringify({
      can_execute_code: false,
      can_modify_files: false,
    }),
  },
  {
    name: 'savorgplanreview',
    role: 'plan_reviewer',
    station: 'spec',
    sessionKey: 'agent:savorgplanreview:main',
    wipLimit: 3,
    model: 'claude-sonnet-4-5-20250929',
    capabilities: JSON.stringify({
      can_execute_code: false,
      can_modify_files: false,
      actions: ['approve', 'reject_with_feedback', 'request_research'],
    }),
  },
  {
    name: 'savorgbuild',
    role: 'builder',
    station: 'build',
    sessionKey: 'agent:savorgbuild:main',
    wipLimit: 2,
    model: 'claude-sonnet-4-5-20250929',
    capabilities: JSON.stringify({
      can_execute_code: true,
      can_modify_files: true,
      requires_approved_plan: true,
    }),
  },
  {
    name: 'savorgbuildreview',
    role: 'build_reviewer',
    station: 'qa',
    sessionKey: 'agent:savorgbuildreview:main',
    wipLimit: 3,
    model: 'claude-sonnet-4-5-20250929',
    capabilities: JSON.stringify({
      can_execute_code: true,  // UPDATED: needs to run tests
      can_modify_files: false,
      actions: ['approve', 'reject_with_feedback'],
      exec_allowlist: ['npm test', 'npm run typecheck', 'npm run lint'],
    }),
  },
  {
    name: 'savorgui',
    role: 'ui_builder',
    station: 'build',
    sessionKey: 'agent:savorgui:main',
    wipLimit: 2,
    model: 'claude-sonnet-4-5-20250929',
    capabilities: JSON.stringify({
      can_execute_code: true,
      can_modify_files: true,
      requires_approved_plan: true,
      ui_skills_enforced: true,
    }),
  },
  {
    name: 'savorguireview',
    role: 'ui_reviewer',
    station: 'qa',
    sessionKey: 'agent:savorguireview:main',
    wipLimit: 3,
    model: 'claude-haiku-4-5-20251001',
    capabilities: JSON.stringify({
      can_execute_code: false,
      can_modify_files: false,
      actions: ['approve', 'reject_with_feedback'],
    }),
  },
  {
    name: 'savorgops',
    role: 'operations',
    station: 'ops',
    sessionKey: 'agent:savorgops:main',
    wipLimit: 2,
    model: 'claude-sonnet-4-5-20250929',
    capabilities: JSON.stringify({
      can_execute_code: true,
      can_modify_files: true,
      requires_approved_plan: true,
    }),
  },
  {
    name: 'savorgsecurity',
    role: 'security_auditor',
    station: 'qa',
    sessionKey: 'agent:savorgsecurity:main',
    wipLimit: 3,
    model: 'claude-opus-4-5-20251101',
    capabilities: JSON.stringify({
      can_execute_code: false,
      can_modify_files: false,
      can_veto: true,
      actions: ['approve', 'veto_with_findings', 'flag_warning'],
    }),
  },
  {
    name: 'savorgresearch',
    role: 'researcher',
    station: 'spec',
    sessionKey: 'agent:savorgresearch:main',
    wipLimit: 3,
    model: 'claude-opus-4-5-20251101',
    capabilities: JSON.stringify({
      can_execute_code: false,
      can_modify_files: false,
      can_web_search: true,
      can_read_files: true,
    }),
  },
]

async function main() {
  for (const agent of AGENTS) {
    await prisma.agent.upsert({
      where: { name: agent.name },
      update: agent,
      create: agent,
    })
  }
  console.log(`Seeded ${AGENTS.length} agents`)
}

main()
```

### 1.2 Add Workflow Tracking Fields

Add new fields to Operation for workflow chain tracking:

```prisma
// Add to Operation model in schema.prisma

model Operation {
  // ... existing fields ...
  
  // Workflow chain tracking (NEW)
  workflowId          String?   @map("workflow_id")     // e.g., "feature_request"
  workflowStageIndex  Int       @default(0) @map("workflow_stage_index")
  iterationCount      Int       @default(0) @map("iteration_count")
  loopTargetOpId      String?   @map("loop_target_op_id")  // for review → build loops
  
  // Escalation tracking (NEW)
  escalatedAt         DateTime? @map("escalated_at")
  escalationReason    String?   @map("escalation_reason")
  
  @@index([workflowId])
}
```

### 1.3 Add WorkOrder Workflow Field

```prisma
// Add to WorkOrder model

model WorkOrder {
  // ... existing fields ...
  
  workflowId    String?   @map("workflow_id")   // Selected workflow chain
  currentStage  Int       @default(0) @map("current_stage")
  
  @@index([workflowId])
}
```

Run migration:
```bash
cd apps/mission-control
npx prisma migrate dev --name workflow_tracking
```

---

## PHASE 2: Workflow Engine

### 2.1 Create Workflow Definitions

```typescript
// apps/mission-control/lib/workflows/definitions.ts

export interface WorkflowStage {
  agent: string
  condition?: string
  optional?: boolean
  loopTarget?: string
  maxIterations?: number
  canVeto?: boolean
}

export interface Workflow {
  id: string
  description: string
  stages: WorkflowStage[]
}

export const WORKFLOWS: Record<string, Workflow> = {
  feature_request: {
    id: 'feature_request',
    description: 'Standard feature implementation',
    stages: [
      { agent: 'savorgresearch', condition: 'unknowns_exist', optional: true },
      { agent: 'savorgplan' },
      { agent: 'savorgplanreview', loopTarget: 'savorgplan', maxIterations: 2 },
      { agent: 'savorgbuild' },
      { agent: 'savorgbuildreview', loopTarget: 'savorgbuild', maxIterations: 2 },
      { agent: 'savorgsecurity', loopTarget: 'savorgbuild', maxIterations: 1, canVeto: true },
      { agent: 'savorgops', condition: 'deployment_needed', optional: true },
    ],
  },
  
  ui_feature: {
    id: 'ui_feature',
    description: 'UI/frontend feature',
    stages: [
      { agent: 'savorgresearch', condition: 'unknowns_exist', optional: true },
      { agent: 'savorgplan' },
      { agent: 'savorgplanreview', loopTarget: 'savorgplan', maxIterations: 2 },
      { agent: 'savorgui' },
      { agent: 'savorguireview', loopTarget: 'savorgui', maxIterations: 2 },
      { agent: 'savorgsecurity', loopTarget: 'savorgui', maxIterations: 1, canVeto: true },
      { agent: 'savorgops', condition: 'deployment_needed', optional: true },
    ],
  },
  
  bug_fix: {
    id: 'bug_fix',
    description: 'Bug fix — abbreviated workflow',
    stages: [
      { agent: 'savorgresearch', condition: 'unknowns_exist', optional: true },
      { agent: 'savorgbuild' },
      { agent: 'savorgbuildreview', loopTarget: 'savorgbuild', maxIterations: 2 },
      { agent: 'savorgsecurity', condition: 'security_relevant', optional: true },
    ],
  },
  
  hotfix: {
    id: 'hotfix',
    description: 'Emergency hotfix — minimal gates',
    stages: [
      { agent: 'savorgbuild' },
      { agent: 'savorgsecurity' },
      { agent: 'savorgops' },
    ],
  },
  
  research_only: {
    id: 'research_only',
    description: 'Pure research / question answering',
    stages: [
      { agent: 'savorgresearch' },
    ],
  },
  
  security_audit: {
    id: 'security_audit',
    description: 'Standalone security audit',
    stages: [
      { agent: 'savorgsecurity' },
      { agent: 'savorgbuildreview', condition: 'code_review_needed', optional: true },
    ],
  },
  
  ops_task: {
    id: 'ops_task',
    description: 'Infrastructure / ops changes',
    stages: [
      { agent: 'savorgplan' },
      { agent: 'savorgplanreview', loopTarget: 'savorgplan', maxIterations: 2 },
      { agent: 'savorgops' },
      { agent: 'savorgsecurity', canVeto: true },
    ],
  },
}
```

### 2.2 Workflow Executor

```typescript
// apps/mission-control/lib/workflows/executor.ts

import { prisma } from '../db'
import { WORKFLOWS, WorkflowStage } from './definitions'
import { spawnAgentSession, sendToSession } from '../openclaw/sessions'
import type { OperationDTO } from '../repo/types'

interface ExecutionContext {
  workOrderId: string
  workflowId: string
  currentStageIndex: number
  operationId: string
  iterationCount: number
  previousOutputs: Record<string, unknown>
}

interface StageResult {
  status: 'approved' | 'rejected' | 'vetoed' | 'completed' | 'escalated'
  output: unknown
  feedback?: string
  artifacts?: string[]
}

/**
 * Advances workflow to next stage or handles loops/escalation
 */
export async function advanceWorkflow(
  ctx: ExecutionContext,
  result: StageResult
): Promise<{ nextAction: 'continue' | 'loop' | 'escalate' | 'complete' }> {
  const workflow = WORKFLOWS[ctx.workflowId]
  if (!workflow) throw new Error(`Unknown workflow: ${ctx.workflowId}`)
  
  const currentStage = workflow.stages[ctx.currentStageIndex]
  
  // Handle veto
  if (result.status === 'vetoed' && currentStage.canVeto) {
    await escalateToCEO(ctx, 'security_veto', result)
    return { nextAction: 'escalate' }
  }
  
  // Handle rejection with loop
  if (result.status === 'rejected' && currentStage.loopTarget) {
    const maxIter = currentStage.maxIterations ?? 2
    
    if (ctx.iterationCount >= maxIter) {
      // Iteration cap exceeded → escalate
      await escalateToCEO(ctx, 'iteration_cap_exceeded', result)
      return { nextAction: 'escalate' }
    }
    
    // Loop back to target
    await loopBackToStage(ctx, currentStage.loopTarget, result.feedback)
    return { nextAction: 'loop' }
  }
  
  // Move to next stage
  const nextIndex = ctx.currentStageIndex + 1
  
  if (nextIndex >= workflow.stages.length) {
    // Workflow complete
    await markWorkOrderComplete(ctx.workOrderId)
    return { nextAction: 'complete' }
  }
  
  // Check if next stage is optional and condition not met
  const nextStage = workflow.stages[nextIndex]
  if (nextStage.optional && nextStage.condition) {
    const conditionMet = evaluateCondition(nextStage.condition, ctx.previousOutputs)
    if (!conditionMet) {
      // Skip optional stage, recurse to next
      return advanceWorkflow({
        ...ctx,
        currentStageIndex: nextIndex,
      }, { status: 'completed', output: { skipped: true } })
    }
  }
  
  // Create operation for next stage
  await createOperationForStage(ctx.workOrderId, workflow, nextIndex)
  return { nextAction: 'continue' }
}

/**
 * Spawns an agent session with proper session key convention
 */
export async function dispatchToAgent(
  agentName: string,
  operationId: string,
  task: string,
  context: Record<string, unknown>
): Promise<string> {
  // Session key convention: agent:<name>:op:<operationId>
  const sessionLabel = `agent:${agentName}:op:${operationId}`
  
  const result = await spawnAgentSession({
    agentId: agentName,
    label: sessionLabel,
    task,
    context,
  })
  
  // Update AgentSession telemetry link
  await prisma.agentSession.updateMany({
    where: { sessionKey: sessionLabel },
    data: { operationId },
  })
  
  return result.sessionKey
}

/**
 * Escalates to CEO with full context
 */
async function escalateToCEO(
  ctx: ExecutionContext,
  reason: string,
  result: StageResult
): Promise<void> {
  // Update operation as escalated
  await prisma.operation.update({
    where: { id: ctx.operationId },
    data: {
      status: 'blocked',
      escalatedAt: new Date(),
      escalationReason: reason,
      blockedReason: result.feedback ?? reason,
    },
  })
  
  // Create approval request
  await prisma.approval.create({
    data: {
      workOrderId: ctx.workOrderId,
      operationId: ctx.operationId,
      type: reason === 'security_veto' ? 'risky_action' : 'scope_change',
      questionMd: buildEscalationMessage(ctx, reason, result),
      status: 'pending',
    },
  })
  
  // Notify CEO via sessions_send
  await sendToSession('agent:savorgceo:main', buildEscalationMessage(ctx, reason, result))
  
  // Log activity
  await prisma.activity.create({
    data: {
      type: `escalation.${reason}`,
      actor: `agent:${WORKFLOWS[ctx.workflowId].stages[ctx.currentStageIndex].agent}`,
      entityType: 'operation',
      entityId: ctx.operationId,
      summary: `Escalated to CEO: ${reason}`,
      payloadJson: JSON.stringify({ reason, feedback: result.feedback }),
    },
  })
}

function buildEscalationMessage(
  ctx: ExecutionContext,
  reason: string,
  result: StageResult
): string {
  const workflow = WORKFLOWS[ctx.workflowId]
  const stage = workflow.stages[ctx.currentStageIndex]
  
  return `## 🚨 Escalation: ${reason}

**Work Order:** ${ctx.workOrderId}
**Workflow:** ${ctx.workflowId} → Stage ${ctx.currentStageIndex + 1}/${workflow.stages.length}
**Agent:** ${stage.agent}
**Iterations:** ${ctx.iterationCount}/${stage.maxIterations ?? 'N/A'}

### Feedback
${result.feedback ?? 'No feedback provided'}

### What happened
${reason === 'iteration_cap_exceeded' 
  ? `Review loop exceeded ${stage.maxIterations} iterations without approval.`
  : reason === 'security_veto'
  ? `Security agent vetoed this change.`
  : `Agent blocked workflow progression.`}

### Action needed
Reply with one of:
- \`APPROVE\` — Override and continue
- \`REJECT\` — Cancel this work order
- \`MODIFY\` — Provide new instructions`
}

async function loopBackToStage(
  ctx: ExecutionContext,
  loopTarget: string,
  feedback?: string
): Promise<void> {
  const workflow = WORKFLOWS[ctx.workflowId]
  const targetIndex = workflow.stages.findIndex(s => s.agent === loopTarget)
  
  if (targetIndex === -1) {
    throw new Error(`Loop target ${loopTarget} not found in workflow ${ctx.workflowId}`)
  }
  
  // Update current operation as in rework
  await prisma.operation.update({
    where: { id: ctx.operationId },
    data: { status: 'rework' },
  })
  
  // Create new operation for the rework cycle
  const newOp = await prisma.operation.create({
    data: {
      workOrderId: ctx.workOrderId,
      station: mapAgentToStation(loopTarget),
      title: `[Rework] ${workflow.stages[targetIndex].agent} iteration ${ctx.iterationCount + 1}`,
      notes: feedback,
      status: 'todo',
      workflowId: ctx.workflowId,
      workflowStageIndex: targetIndex,
      iterationCount: ctx.iterationCount + 1,
      loopTargetOpId: ctx.operationId,
    },
  })
  
  // Log activity
  await prisma.activity.create({
    data: {
      type: 'workflow.loop',
      actor: 'system',
      entityType: 'operation',
      entityId: newOp.id,
      summary: `Looped back to ${loopTarget} (iteration ${ctx.iterationCount + 1})`,
      payloadJson: JSON.stringify({ feedback, previousOpId: ctx.operationId }),
    },
  })
}

async function createOperationForStage(
  workOrderId: string,
  workflow: { stages: WorkflowStage[] },
  stageIndex: number
): Promise<void> {
  const stage = workflow.stages[stageIndex]
  
  await prisma.operation.create({
    data: {
      workOrderId,
      station: mapAgentToStation(stage.agent),
      title: `${stage.agent} — ${workflow.stages[stageIndex].agent}`,
      status: 'todo',
      workflowId: workflow.id,
      workflowStageIndex: stageIndex,
      iterationCount: 0,
      assigneeAgentIds: JSON.stringify([stage.agent]),
    },
  })
  
  // Update work order current stage
  await prisma.workOrder.update({
    where: { id: workOrderId },
    data: { currentStage: stageIndex },
  })
}

function mapAgentToStation(agentName: string): string {
  const stationMap: Record<string, string> = {
    savorgguard: 'screen',
    savorgceo: 'strategic',
    savorgmanager: 'orchestration',
    savorgresearch: 'spec',
    savorgplan: 'spec',
    savorgplanreview: 'spec',
    savorgbuild: 'build',
    savorgbuildreview: 'qa',
    savorgui: 'build',
    savorguireview: 'qa',
    savorgops: 'ops',
    savorgsecurity: 'qa',
  }
  return stationMap[agentName] ?? 'build'
}

function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  // Simple condition evaluation
  switch (condition) {
    case 'unknowns_exist':
      return Boolean(context.hasUnknowns)
    case 'deployment_needed':
      return Boolean(context.needsDeployment)
    case 'security_relevant':
      return Boolean(context.touchesSecurity)
    case 'code_review_needed':
      return Boolean(context.hasCodeChanges)
    default:
      return true
  }
}

async function markWorkOrderComplete(workOrderId: string): Promise<void> {
  await prisma.workOrder.update({
    where: { id: workOrderId },
    data: {
      state: 'shipped',
      shippedAt: new Date(),
    },
  })
  
  await prisma.activity.create({
    data: {
      type: 'work_order.shipped',
      actor: 'system',
      entityType: 'work_order',
      entityId: workOrderId,
      summary: 'Work order completed all workflow stages',
      payloadJson: '{}',
    },
  })
}
```

---

## PHASE 3: Tool Policy Enforcement

### 3.1 Policy Checker

```typescript
// apps/mission-control/lib/policies/tool-policy.ts

import { prisma } from '../db'

export interface ToolRequest {
  agentName: string
  tool: string
  args?: Record<string, unknown>
}

export interface PolicyResult {
  allowed: boolean
  reason?: string
  requiresApproval?: boolean
  approvalType?: string
}

/**
 * Checks if an agent is allowed to use a specific tool
 */
export async function checkToolPolicy(request: ToolRequest): Promise<PolicyResult> {
  const agent = await prisma.agent.findUnique({
    where: { name: request.agentName },
  })
  
  if (!agent) {
    return { allowed: false, reason: `Unknown agent: ${request.agentName}` }
  }
  
  const capabilities = JSON.parse(agent.capabilities)
  
  // Tool → capability mapping
  const toolRequirements: Record<string, string[]> = {
    exec: ['can_execute_code'],
    write: ['can_modify_files'],
    edit: ['can_modify_files'],
    message: ['can_send_messages'],
    sessions_spawn: ['can_delegate'],
    sessions_send: ['can_delegate'],
    web_search: ['can_web_search'],
    web_fetch: ['can_web_search'],
    browser: ['can_execute_code'], // Browser automation is code execution
  }
  
  const requiredCaps = toolRequirements[request.tool] ?? []
  
  for (const cap of requiredCaps) {
    if (!capabilities[cap]) {
      return {
        allowed: false,
        reason: `Agent ${request.agentName} lacks capability: ${cap}`,
      }
    }
  }
  
  // Special case: BuildReview exec allowlist
  if (request.tool === 'exec' && request.agentName === 'savorgbuildreview') {
    const allowlist = capabilities.exec_allowlist ?? []
    const command = String(request.args?.command ?? '')
    
    const isAllowed = allowlist.some((pattern: string) => 
      command.startsWith(pattern)
    )
    
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Command not in BuildReview allowlist: ${command}`,
      }
    }
  }
  
  // Check if agent requires approved plan
  if (capabilities.requires_approved_plan) {
    // This would be checked at workflow level, not tool level
    // Just flag it for the workflow engine
  }
  
  return { allowed: true }
}

/**
 * Middleware for API routes that enforces tool policies
 */
export function withToolPolicy(handler: Function) {
  return async (req: Request, ...args: unknown[]) => {
    const body = await req.json()
    
    if (body.agentName && body.tool) {
      const result = await checkToolPolicy({
        agentName: body.agentName,
        tool: body.tool,
        args: body.args,
      })
      
      if (!result.allowed) {
        return Response.json(
          { error: 'POLICY_DENIED', reason: result.reason },
          { status: 403 }
        )
      }
    }
    
    return handler(req, ...args)
  }
}
```

---

## PHASE 4: Manager Orchestration

### 4.1 Manager Service

```typescript
// apps/mission-control/lib/services/manager.ts

import { prisma } from '../db'
import { WORKFLOWS } from '../workflows/definitions'
import { dispatchToAgent, advanceWorkflow } from '../workflows/executor'

interface ManagerState {
  activeWorkOrders: Map<string, WorkOrderContext>
}

interface WorkOrderContext {
  workOrderId: string
  workflowId: string
  currentStage: number
  activeOperationId?: string
  pendingResults: Map<string, unknown>
}

const state: ManagerState = {
  activeWorkOrders: new Map(),
}

/**
 * Manager receives a task from CEO and initiates a workflow
 */
export async function initiateWorkflow(
  workOrderId: string,
  workflowId: string,
  initialContext: Record<string, unknown>
): Promise<void> {
  const workflow = WORKFLOWS[workflowId]
  if (!workflow) {
    throw new Error(`Unknown workflow: ${workflowId}`)
  }
  
  // Update work order with workflow
  await prisma.workOrder.update({
    where: { id: workOrderId },
    data: {
      workflowId,
      currentStage: 0,
      state: 'active',
    },
  })
  
  // Find first non-optional stage (or evaluate conditions)
  let startIndex = 0
  for (let i = 0; i < workflow.stages.length; i++) {
    const stage = workflow.stages[i]
    if (stage.optional && stage.condition) {
      const conditionMet = evaluateCondition(stage.condition, initialContext)
      if (!conditionMet) {
        startIndex = i + 1
        continue
      }
    }
    startIndex = i
    break
  }
  
  // Create first operation
  const firstStage = workflow.stages[startIndex]
  const operation = await prisma.operation.create({
    data: {
      workOrderId,
      station: mapAgentToStation(firstStage.agent),
      title: `${firstStage.agent} — Initial`,
      status: 'in_progress',
      workflowId,
      workflowStageIndex: startIndex,
      iterationCount: 0,
      assigneeAgentIds: JSON.stringify([firstStage.agent]),
    },
  })
  
  // Track state
  state.activeWorkOrders.set(workOrderId, {
    workOrderId,
    workflowId,
    currentStage: startIndex,
    activeOperationId: operation.id,
    pendingResults: new Map(),
  })
  
  // Dispatch to first agent
  const workOrder = await prisma.workOrder.findUnique({ where: { id: workOrderId } })
  
  await dispatchToAgent(
    firstStage.agent,
    operation.id,
    workOrder?.goalMd ?? '',
    initialContext
  )
  
  // Log activity
  await prisma.activity.create({
    data: {
      type: 'workflow.started',
      actor: 'agent:savorgmanager',
      entityType: 'work_order',
      entityId: workOrderId,
      summary: `Started workflow: ${workflowId}`,
      payloadJson: JSON.stringify({ workflow: workflowId, firstAgent: firstStage.agent }),
    },
  })
}

/**
 * Manager receives completion from an agent
 */
export async function handleAgentCompletion(
  operationId: string,
  result: {
    status: 'approved' | 'rejected' | 'vetoed' | 'completed'
    output: unknown
    feedback?: string
    artifacts?: string[]
  }
): Promise<void> {
  const operation = await prisma.operation.findUnique({
    where: { id: operationId },
    include: { workOrder: true },
  })
  
  if (!operation) {
    throw new Error(`Operation not found: ${operationId}`)
  }
  
  const ctx = state.activeWorkOrders.get(operation.workOrderId)
  if (!ctx) {
    // Rebuild context from DB
    ctx = {
      workOrderId: operation.workOrderId,
      workflowId: operation.workflowId ?? 'feature_request',
      currentStage: operation.workflowStageIndex,
      activeOperationId: operationId,
      pendingResults: new Map(),
    }
  }
  
  // Update operation status
  await prisma.operation.update({
    where: { id: operationId },
    data: {
      status: result.status === 'approved' || result.status === 'completed' ? 'done' : 'blocked',
      notes: result.feedback,
    },
  })
  
  // Create receipt
  await prisma.receipt.create({
    data: {
      workOrderId: operation.workOrderId,
      operationId,
      kind: 'agent_run',
      commandName: `agent:${operation.assigneeAgentIds}`,
      exitCode: result.status === 'approved' || result.status === 'completed' ? 0 : 1,
      parsedJson: JSON.stringify(result.output),
      endedAt: new Date(),
    },
  })
  
  // Create artifacts
  if (result.artifacts) {
    for (const artifact of result.artifacts) {
      await prisma.artifact.create({
        data: {
          workOrderId: operation.workOrderId,
          operationId,
          type: inferArtifactType(artifact),
          title: artifact,
          pathOrUrl: artifact,
          createdBy: operation.assigneeAgentIds,
        },
      })
    }
  }
  
  // Advance workflow
  const { nextAction } = await advanceWorkflow(
    {
      workOrderId: operation.workOrderId,
      workflowId: ctx.workflowId,
      currentStageIndex: ctx.currentStage,
      operationId,
      iterationCount: operation.iterationCount,
      previousOutputs: Object.fromEntries(ctx.pendingResults),
    },
    result
  )
  
  // Handle next action
  switch (nextAction) {
    case 'complete':
      // Notify CEO
      await notifyCEO(operation.workOrderId, 'completed', {
        workflowId: ctx.workflowId,
        totalOperations: await prisma.operation.count({
          where: { workOrderId: operation.workOrderId },
        }),
      })
      state.activeWorkOrders.delete(operation.workOrderId)
      break
      
    case 'escalate':
      // Already handled in advanceWorkflow
      break
      
    case 'loop':
    case 'continue':
      // Next operation will be dispatched by advanceWorkflow
      break
  }
}

async function notifyCEO(
  workOrderId: string,
  event: string,
  data: Record<string, unknown>
): Promise<void> {
  const workOrder = await prisma.workOrder.findUnique({ where: { id: workOrderId } })
  
  const message = event === 'completed'
    ? `✅ **Work Order Complete:** ${workOrder?.code}\n\n${workOrder?.title}\n\nAll stages passed.`
    : `⚠️ **Work Order Update:** ${workOrder?.code}\n\nEvent: ${event}`
  
  // Send to CEO session
  await sendToSession('agent:savorgceo:main', message)
  
  await prisma.activity.create({
    data: {
      type: `manager.notify_ceo`,
      actor: 'agent:savorgmanager',
      entityType: 'work_order',
      entityId: workOrderId,
      summary: `Notified CEO: ${event}`,
      payloadJson: JSON.stringify(data),
    },
  })
}

function inferArtifactType(path: string): string {
  if (path.includes('github.com/') && path.includes('/pull/')) return 'pr'
  if (path.endsWith('.md')) return 'doc'
  if (path.endsWith('.png') || path.endsWith('.jpg')) return 'screenshot'
  if (path.startsWith('http')) return 'link'
  return 'file'
}

function evaluateCondition(condition: string, context: Record<string, unknown>): boolean {
  switch (condition) {
    case 'unknowns_exist': return Boolean(context.hasUnknowns)
    case 'deployment_needed': return Boolean(context.needsDeployment)
    case 'security_relevant': return Boolean(context.touchesSecurity)
    default: return true
  }
}

function mapAgentToStation(agentName: string): string {
  const map: Record<string, string> = {
    savorgresearch: 'spec', savorgplan: 'spec', savorgplanreview: 'spec',
    savorgbuild: 'build', savorgui: 'build',
    savorgbuildreview: 'qa', savorguireview: 'qa', savorgsecurity: 'qa',
    savorgops: 'ops',
  }
  return map[agentName] ?? 'build'
}
```

---

## PHASE 5: OpenClaw Session Integration

### 5.1 Session Spawner

```typescript
// apps/mission-control/lib/openclaw/sessions.ts

import { exec } from 'child_process'
import { promisify } from 'util'
import { prisma } from '../db'

const execAsync = promisify(exec)

interface SpawnOptions {
  agentId: string
  label: string
  task: string
  context?: Record<string, unknown>
  model?: string
  timeoutSeconds?: number
}

interface SpawnResult {
  sessionKey: string
  sessionId: string
}

/**
 * Spawns an OpenClaw agent session with proper session key convention
 * Convention: agent:<name>:op:<operationId>
 */
export async function spawnAgentSession(options: SpawnOptions): Promise<SpawnResult> {
  const { agentId, label, task, context, model, timeoutSeconds = 300 } = options
  
  // Use OpenClaw's sessions_spawn via CLI for now
  // In production, this would use the gateway HTTP API
  const cmd = [
    'openclaw',
    'run',
    agentId,
    '--label', label,
    '--timeout', String(timeoutSeconds),
    model ? `--model ${model}` : '',
    '--',
    JSON.stringify({ task, context }),
  ].filter(Boolean).join(' ')
  
  const { stdout } = await execAsync(cmd)
  const result = JSON.parse(stdout)
  
  return {
    sessionKey: label,
    sessionId: result.sessionId,
  }
}

/**
 * Sends a message to an existing session
 */
export async function sendToSession(sessionKey: string, message: string): Promise<void> {
  const cmd = `openclaw send --session "${sessionKey}" "${message.replace(/"/g, '\\"')}"`
  await execAsync(cmd)
}

/**
 * Syncs OpenClaw sessions to AgentSession telemetry table
 */
export async function syncAgentSessions(): Promise<void> {
  const { stdout } = await execAsync('openclaw status --all --json')
  const sessions = JSON.parse(stdout)
  
  for (const session of sessions) {
    // Extract operation linkage from session key
    // Convention: agent:<name>:op:<operationId>
    const opMatch = session.sessionKey?.match(/:op:([a-z0-9]+)$/i)
    const operationId = opMatch ? opMatch[1] : null
    
    await prisma.agentSession.upsert({
      where: { sessionId: session.id },
      update: {
        state: session.aborted ? 'error' : session.active ? 'active' : 'idle',
        percentUsed: session.percentUsed,
        lastSeenAt: new Date(),
        updatedAtMs: BigInt(Date.now()),
        operationId,
        rawJson: JSON.stringify(session),
      },
      create: {
        sessionId: session.id,
        sessionKey: session.sessionKey,
        agentId: session.agentId,
        kind: session.kind,
        model: session.model,
        state: session.active ? 'active' : 'idle',
        percentUsed: session.percentUsed,
        lastSeenAt: new Date(),
        updatedAtMs: BigInt(Date.now()),
        operationId,
        rawJson: JSON.stringify(session),
      },
    })
  }
}
```

---

## PHASE 6: API Routes

### 6.1 Workflow API

```typescript
// apps/mission-control/app/api/workflows/route.ts

import { NextResponse } from 'next/server'
import { WORKFLOWS } from '@/lib/workflows/definitions'

export async function GET() {
  return NextResponse.json({
    data: Object.values(WORKFLOWS),
  })
}
```

```typescript
// apps/mission-control/app/api/workflows/[id]/start/route.ts

import { NextResponse } from 'next/server'
import { initiateWorkflow } from '@/lib/services/manager'
import { prisma } from '@/lib/db'

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const body = await request.json()
  const { workOrderId, context } = body
  
  // Verify work order exists
  const workOrder = await prisma.workOrder.findUnique({
    where: { id: workOrderId },
  })
  
  if (!workOrder) {
    return NextResponse.json(
      { error: 'Work order not found' },
      { status: 404 }
    )
  }
  
  await initiateWorkflow(workOrderId, params.id, context ?? {})
  
  return NextResponse.json({
    success: true,
    workflowId: params.id,
    workOrderId,
  })
}
```

### 6.2 Agent Completion Webhook

```typescript
// apps/mission-control/app/api/agents/completion/route.ts

import { NextResponse } from 'next/server'
import { handleAgentCompletion } from '@/lib/services/manager'

export async function POST(request: Request) {
  const body = await request.json()
  const { operationId, status, output, feedback, artifacts } = body
  
  if (!operationId || !status) {
    return NextResponse.json(
      { error: 'Missing operationId or status' },
      { status: 400 }
    )
  }
  
  await handleAgentCompletion(operationId, {
    status,
    output,
    feedback,
    artifacts,
  })
  
  return NextResponse.json({ success: true })
}
```

---

## PHASE 7: Model Identifier Updates

Update `savorg.config.yaml` with current model API names:

```yaml
# CORRECT model identifiers (as of 2026-02)
models:
  tier_1_reasoning:
    primary:
      provider: "anthropic"
      model: "claude-opus-4-5"  # No date suffix needed
    fallback:
      provider: "anthropic"
      model: "claude-sonnet-4-5"

  tier_2_workhorse:
    primary:
      provider: "anthropic"
      model: "claude-sonnet-4-5"
    fallback:
      provider: "anthropic"
      model: "claude-haiku-4-5"

  tier_3_fast:
    primary:
      provider: "anthropic"
      model: "claude-haiku-4-5"
    fallback:
      provider: "anthropic"
      model: "claude-sonnet-4-5"
```

---

## PHASE 8: Integration Test Checklist

### Pre-flight
- [ ] Run `npx prisma migrate dev --name workflow_tracking`
- [ ] Run `npx prisma db seed` to seed agents
- [ ] Verify agents in DB: `npx prisma studio`

### Workflow Tests
- [ ] Create work order via UI/API
- [ ] Start `feature_request` workflow
- [ ] Verify Operation created for first stage
- [ ] Mock agent completion → verify next stage created
- [ ] Test rejection → verify loop back
- [ ] Test iteration cap → verify escalation

### Policy Tests
- [ ] savorgbuild can use `exec` and `write`
- [ ] savorgplanreview cannot use `exec`
- [ ] savorgbuildreview can only use allowlisted commands
- [ ] savorgsecurity cannot modify files

### Session Linkage Tests
- [ ] Spawn agent with `:op:<id>` session key
- [ ] Verify AgentSession.operationId populated
- [ ] Query sessions by operationId

---

## Files to Create/Modify

| Path | Action |
|------|--------|
| `prisma/schema.prisma` | Add workflow fields |
| `prisma/seed.ts` | Create agent seeder |
| `lib/workflows/definitions.ts` | Create |
| `lib/workflows/executor.ts` | Create |
| `lib/policies/tool-policy.ts` | Create |
| `lib/services/manager.ts` | Create |
| `lib/openclaw/sessions.ts` | Create |
| `app/api/workflows/route.ts` | Create |
| `app/api/workflows/[id]/start/route.ts` | Create |
| `app/api/agents/completion/route.ts` | Create |
| `savorg.config.yaml` | Update model names |

---

## Success Criteria

1. **Work Orders flow through workflows** — state transitions tracked in SQLite
2. **Operations link to sessions** — `:op:<id>` convention visible in AgentSession table
3. **Tool policies enforced** — denied requests logged with reason
4. **Escalations reach CEO** — Approval records created, CEO session receives message
5. **Receipts capture everything** — Every agent run has a receipt with outputs
6. **Activity audit complete** — Full trail in Activity table

---

*Generated by SavorgCEO | 2026-02-04*
