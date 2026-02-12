import Ajv, { type ErrorObject } from 'ajv'
import {
  WORKFLOW_SCHEMA,
  WORKFLOW_SELECTION_SCHEMA,
  type WorkflowConfig,
  type WorkflowSelectionConfig,
  type WorkflowSelectionRule,
} from '@clawcontrol/core'

const ajv = new Ajv({ allErrors: true })
export const validateWorkflowSchema = ajv.compile(WORKFLOW_SCHEMA)
export const validateSelectionSchema = ajv.compile(WORKFLOW_SELECTION_SCHEMA)

export function formatAjvErrors(errors: ErrorObject[] | null | undefined): string {
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

export function validateWorkflowSemantics(workflow: WorkflowConfig, source: string): void {
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

export function validateSelectionSemantics(
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

export function orderSelectionRulesByPrecedence(rules: WorkflowSelectionRule[]): WorkflowSelectionRule[] {
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
