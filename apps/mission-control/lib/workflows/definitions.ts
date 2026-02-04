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

  full_stack_feature: {
    id: 'full_stack_feature',
    description: 'Feature with backend + UI',
    stages: [
      { agent: 'savorgresearch', condition: 'unknowns_exist', optional: true },
      { agent: 'savorgplan' },
      { agent: 'savorgplanreview', loopTarget: 'savorgplan', maxIterations: 2 },
      { agent: 'savorgbuild' },
      { agent: 'savorgbuildreview', loopTarget: 'savorgbuild', maxIterations: 2 },
      { agent: 'savorgui' },
      { agent: 'savorguireview', loopTarget: 'savorgui', maxIterations: 2 },
      { agent: 'savorgsecurity', canVeto: true },
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

