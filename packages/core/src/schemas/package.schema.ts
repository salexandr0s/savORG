export const CLAW_PACKAGE_KIND_VALUES = [
  'agent_template',
  'agent_team',
  'workflow',
  'team_with_workflows',
] as const

export type ClawPackageKind = (typeof CLAW_PACKAGE_KIND_VALUES)[number]

export interface ClawPackageManifest {
  id: string
  name: string
  version: string
  kind: ClawPackageKind
  description?: string
  createdAt?: string
  createdBy?: string
}

export const CLAW_PACKAGE_ID_PATTERN = '^[a-z][a-z0-9_-]{2,63}$'

export const CLAW_PACKAGE_MANIFEST_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: ['id', 'name', 'version', 'kind'],
  properties: {
    id: {
      type: 'string',
      pattern: CLAW_PACKAGE_ID_PATTERN,
    },
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 120,
    },
    version: {
      type: 'string',
      minLength: 1,
      maxLength: 40,
    },
    kind: {
      type: 'string',
      enum: CLAW_PACKAGE_KIND_VALUES,
    },
    description: {
      type: 'string',
      maxLength: 1000,
    },
    createdAt: {
      type: 'string',
      minLength: 1,
    },
    createdBy: {
      type: 'string',
      maxLength: 120,
    },
  },
  additionalProperties: false,
} as const
