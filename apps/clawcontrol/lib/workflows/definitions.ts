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
      { agent: 'research', condition: 'unknowns_exist', optional: true },
      { agent: 'plan' },
      { agent: 'plan_review', loopTarget: 'plan', maxIterations: 2 },
      { agent: 'build' },
      { agent: 'build_review', loopTarget: 'build', maxIterations: 2 },
      { agent: 'security', loopTarget: 'build', maxIterations: 1, canVeto: true },
      { agent: 'ops', condition: 'deployment_needed', optional: true },
    ],
  },

  ui_feature: {
    id: 'ui_feature',
    description: 'UI/frontend feature',
    stages: [
      { agent: 'research', condition: 'unknowns_exist', optional: true },
      { agent: 'plan' },
      { agent: 'plan_review', loopTarget: 'plan', maxIterations: 2 },
      { agent: 'ui' },
      { agent: 'ui_review', loopTarget: 'ui', maxIterations: 2 },
      { agent: 'security', loopTarget: 'ui', maxIterations: 1, canVeto: true },
      { agent: 'ops', condition: 'deployment_needed', optional: true },
    ],
  },

  full_stack_feature: {
    id: 'full_stack_feature',
    description: 'Feature with backend + UI',
    stages: [
      { agent: 'research', condition: 'unknowns_exist', optional: true },
      { agent: 'plan' },
      { agent: 'plan_review', loopTarget: 'plan', maxIterations: 2 },
      { agent: 'build' },
      { agent: 'build_review', loopTarget: 'build', maxIterations: 2 },
      { agent: 'ui' },
      { agent: 'ui_review', loopTarget: 'ui', maxIterations: 2 },
      { agent: 'security', canVeto: true },
      { agent: 'ops', condition: 'deployment_needed', optional: true },
    ],
  },

  bug_fix: {
    id: 'bug_fix',
    description: 'Bug fix — abbreviated workflow',
    stages: [
      { agent: 'research', condition: 'unknowns_exist', optional: true },
      { agent: 'build' },
      { agent: 'build_review', loopTarget: 'build', maxIterations: 2 },
      { agent: 'security', condition: 'security_relevant', optional: true },
    ],
  },

  hotfix: {
    id: 'hotfix',
    description: 'Emergency hotfix — minimal gates',
    stages: [{ agent: 'build' }, { agent: 'security' }, { agent: 'ops' }],
  },

  research_only: {
    id: 'research_only',
    description: 'Pure research / question answering',
    stages: [{ agent: 'research' }],
  },

  security_audit: {
    id: 'security_audit',
    description: 'Standalone security audit',
    stages: [
      { agent: 'security' },
      { agent: 'build_review', condition: 'code_review_needed', optional: true },
    ],
  },

  ops_task: {
    id: 'ops_task',
    description: 'Infrastructure / ops changes',
    stages: [
      { agent: 'plan' },
      { agent: 'plan_review', loopTarget: 'plan', maxIterations: 2 },
      { agent: 'ops' },
      { agent: 'security', canVeto: true },
    ],
  },
}
