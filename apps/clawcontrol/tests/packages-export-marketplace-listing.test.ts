import JSZip from 'jszip'
import yaml from 'js-yaml'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getWorkflowDefinition: vi.fn(),
}))

vi.mock('@/lib/repo', () => ({
  getRepos: () => ({
    agentTeams: {
      getById: vi.fn(),
    },
  }),
}))

vi.mock('@/lib/fs/path-policy', () => ({
  validateWorkspacePath: () => ({
    valid: false,
    error: 'history disabled in test',
  }),
}))

vi.mock('@/lib/templates', () => ({
  getTemplateById: vi.fn(),
  getTemplateFileContent: vi.fn(),
  getTemplateFiles: vi.fn(),
  invalidateTemplatesCache: vi.fn(),
}))

vi.mock('@/lib/workflows/registry', () => ({
  getWorkflowDefinition: mocks.getWorkflowDefinition,
  getWorkflowRegistrySnapshot: vi.fn(),
  syncResolvedWorkflowSnapshots: vi.fn(),
}))

vi.mock('@/lib/workflows/service', () => ({
  importCustomWorkflows: vi.fn(),
  upsertWorkflowSelection: vi.fn(),
}))

vi.mock('@/lib/workflows/storage', () => ({
  deleteWorkspaceSelectionOverlay: vi.fn(),
  deleteWorkspaceWorkflowConfig: vi.fn(),
  readWorkspaceSelectionOverlay: vi.fn(),
  writeWorkspaceSelectionOverlay: vi.fn(),
}))

vi.mock('@/lib/workflows/validation', () => ({
  formatAjvErrors: vi.fn(),
  validateSelectionSchema: Object.assign(vi.fn(), { errors: null }),
  validateSelectionSemantics: vi.fn(),
  validateWorkflowSchema: Object.assign(vi.fn(), { errors: null }),
  validateWorkflowSemantics: vi.fn(),
}))

beforeEach(() => {
  vi.resetModules()
  mocks.getWorkflowDefinition.mockReset()
})

describe('package export marketplace sidecar', () => {
  it('writes marketplace/listing.yaml next to clawcontrol-package.yaml', async () => {
    mocks.getWorkflowDefinition.mockResolvedValue({
      id: 'custom_flow',
      workflow: {
        id: 'custom_flow',
        description: 'Custom flow',
        stages: [
          {
            ref: 'plan',
            agent: 'plan',
          },
        ],
      },
    })

    const { buildPackageExport } = await import('@/lib/packages/service')

    const exported = await buildPackageExport({
      kind: 'workflow',
      id: 'custom_flow',
    })

    const zip = await JSZip.loadAsync(exported.content)

    expect(Object.keys(zip.files)).toContain('clawcontrol-package.yaml')
    expect(Object.keys(zip.files)).toContain('marketplace/listing.yaml')
    expect(Object.keys(zip.files)).toContain('workflows/custom_flow.yaml')

    const listingRaw = await zip.file('marketplace/listing.yaml')?.async('string')
    expect(listingRaw).toBeTruthy()

    const listing = yaml.load(listingRaw || '') as {
      slug?: string
      title?: string
      tags?: string[]
    }

    expect(listing.slug).toBe('custom-flow')
    expect(listing.title).toBe('custom_flow')
    expect(listing.tags).toContain('workflow')
  })
})
