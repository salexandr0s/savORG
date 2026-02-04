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
      { agent: 'clawcontrolresearch', condition: 'unknowns_exist', optional: true },
      { agent: 'clawcontrolplan' },
      { agent: 'clawcontrolplanreview', loopTarget: 'clawcontrolplan', maxIterations: 2 },
      { agent: 'clawcontrolbuild' },
      { agent: 'clawcontrolbuildreview', loopTarget: 'clawcontrolbuild', maxIterations: 2 },
      { agent: 'clawcontrolsecurity', loopTarget: 'clawcontrolbuild', maxIterations: 1, canVeto: true },
      { agent: 'clawcontrolops', condition: 'deployment_needed', optional: true },
    ],
  },

  ui_feature: {
    id: 'ui_feature',
    description: 'UI/frontend feature',
    stages: [
      { agent: 'clawcontrolresearch', condition: 'unknowns_exist', optional: true },
      { agent: 'clawcontrolplan' },
      { agent: 'clawcontrolplanreview', loopTarget: 'clawcontrolplan', maxIterations: 2 },
      { agent: 'clawcontrolui' },
      { agent: 'clawcontroluireview', loopTarget: 'clawcontrolui', maxIterations: 2 },
      { agent: 'clawcontrolsecurity', loopTarget: 'clawcontrolui', maxIterations: 1, canVeto: true },
      { agent: 'clawcontrolops', condition: 'deployment_needed', optional: true },
    ],
  },

  full_stack_feature: {
    id: 'full_stack_feature',
    description: 'Feature with backend + UI',
    stages: [
      { agent: 'clawcontrolresearch', condition: 'unknowns_exist', optional: true },
      { agent: 'clawcontrolplan' },
      { agent: 'clawcontrolplanreview', loopTarget: 'clawcontrolplan', maxIterations: 2 },
      { agent: 'clawcontrolbuild' },
      { agent: 'clawcontrolbuildreview', loopTarget: 'clawcontrolbuild', maxIterations: 2 },
      { agent: 'clawcontrolui' },
      { agent: 'clawcontroluireview', loopTarget: 'clawcontrolui', maxIterations: 2 },
      { agent: 'clawcontrolsecurity', canVeto: true },
      { agent: 'clawcontrolops', condition: 'deployment_needed', optional: true },
    ],
  },

  bug_fix: {
    id: 'bug_fix',
    description: 'Bug fix — abbreviated workflow',
    stages: [
      { agent: 'clawcontrolresearch', condition: 'unknowns_exist', optional: true },
      { agent: 'clawcontrolbuild' },
      { agent: 'clawcontrolbuildreview', loopTarget: 'clawcontrolbuild', maxIterations: 2 },
      { agent: 'clawcontrolsecurity', condition: 'security_relevant', optional: true },
    ],
  },

  hotfix: {
    id: 'hotfix',
    description: 'Emergency hotfix — minimal gates',
    stages: [{ agent: 'clawcontrolbuild' }, { agent: 'clawcontrolsecurity' }, { agent: 'clawcontrolops' }],
  },

  research_only: {
    id: 'research_only',
    description: 'Pure research / question answering',
    stages: [{ agent: 'clawcontrolresearch' }],
  },

  security_audit: {
    id: 'security_audit',
    description: 'Standalone security audit',
    stages: [
      { agent: 'clawcontrolsecurity' },
      { agent: 'clawcontrolbuildreview', condition: 'code_review_needed', optional: true },
    ],
  },

  ops_task: {
    id: 'ops_task',
    description: 'Infrastructure / ops changes',
    stages: [
      { agent: 'clawcontrolplan' },
      { agent: 'clawcontrolplanreview', loopTarget: 'clawcontrolplan', maxIterations: 2 },
      { agent: 'clawcontrolops' },
      { agent: 'clawcontrolsecurity', canVeto: true },
    ],
  },
}

