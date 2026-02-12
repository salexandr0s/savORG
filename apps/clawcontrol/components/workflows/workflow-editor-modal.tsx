'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button, SegmentedToggle, SelectDropdown } from '@clawcontrol/ui'
import { Modal } from '@/components/ui/modal'
import { YamlEditor } from '@/components/editors/yaml-editor'
import type { WorkflowDetail } from '@/lib/http'
import { Plus, Trash2 } from 'lucide-react'

type WorkflowDraft = WorkflowDetail['workflow']

interface WorkflowEditorModalProps {
  open: boolean
  mode: 'create' | 'edit'
  initialWorkflow?: WorkflowDraft | null
  onClose: () => void
  onSave: (workflow: WorkflowDraft) => Promise<void>
}

const WORKFLOW_ID_REGEX = /^[a-z][a-z0-9_-]{2,63}$/

function makeEmptyWorkflow(): WorkflowDraft {
  return {
    id: '',
    description: '',
    stages: [
      {
        ref: 'plan',
        agent: 'plan',
        type: 'single',
      },
    ],
  }
}

function cloneWorkflowDraft(workflow: WorkflowDraft): WorkflowDraft {
  return {
    id: workflow.id,
    description: workflow.description,
    stages: workflow.stages.map((stage) => ({
      ...stage,
      loop: stage.loop ? { ...stage.loop } : undefined,
    })),
  }
}

function validateWorkflowDraft(workflow: WorkflowDraft): string[] {
  const errors: string[] = []

  if (!WORKFLOW_ID_REGEX.test(workflow.id)) {
    errors.push('Workflow id must match ^[a-z][a-z0-9_-]{2,63}$')
  }

  if (!workflow.description.trim()) {
    errors.push('Description is required')
  }

  if (!Array.isArray(workflow.stages) || workflow.stages.length === 0) {
    errors.push('At least one stage is required')
    return errors
  }

  const refs = new Set<string>()
  for (const stage of workflow.stages) {
    if (!stage.ref?.trim()) {
      errors.push('Each stage requires a ref')
      continue
    }
    if (refs.has(stage.ref)) {
      errors.push(`Duplicate stage ref: ${stage.ref}`)
    }
    refs.add(stage.ref)

    if (!stage.agent?.trim()) {
      errors.push(`Stage ${stage.ref} requires an agent`) 
    }

    if (stage.type === 'loop' && !stage.loop) {
      errors.push(`Stage ${stage.ref} is loop type but missing loop config`)
    }
  }

  return errors
}

async function dumpYaml(value: WorkflowDraft): Promise<string> {
  const jsYaml = (await import('js-yaml')).default
  return jsYaml.dump(value, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
    sortKeys: false,
  })
}

async function parseYaml(value: string): Promise<WorkflowDraft> {
  const jsYaml = (await import('js-yaml')).default
  const parsed = jsYaml.load(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('YAML must define a workflow object')
  }

  const workflow = parsed as WorkflowDraft
  if (!Array.isArray(workflow.stages)) {
    throw new Error('Workflow stages must be an array')
  }

  return workflow
}

export function WorkflowEditorModal({
  open,
  mode,
  initialWorkflow,
  onClose,
  onSave,
}: WorkflowEditorModalProps) {
  const [editorMode, setEditorMode] = useState<'builder' | 'yaml'>('builder')
  const [draft, setDraft] = useState<WorkflowDraft>(makeEmptyWorkflow())
  const [yamlText, setYamlText] = useState('')
  const [yamlError, setYamlError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    const workflow = initialWorkflow ? cloneWorkflowDraft(initialWorkflow) : makeEmptyWorkflow()
    setDraft(workflow)
    setEditorMode('builder')
    setYamlError(null)
    void dumpYaml(workflow).then(setYamlText)
  }, [open, initialWorkflow])

  useEffect(() => {
    if (!open) return
    if (editorMode !== 'builder') return
    void dumpYaml(draft).then(setYamlText)
  }, [open, editorMode, draft])

  const validationErrors = useMemo(() => {
    if (editorMode === 'yaml') {
      if (yamlError) return [yamlError]
      return []
    }
    return validateWorkflowDraft(draft)
  }, [editorMode, draft, yamlError])

  const canSave = validationErrors.length === 0 && !isSaving

  async function handleYamlChange(nextValue: string) {
    setYamlText(nextValue)
    try {
      const parsed = await parseYaml(nextValue)
      setYamlError(null)
      setDraft(parsed)
    } catch (error) {
      setYamlError(error instanceof Error ? error.message : 'Invalid YAML')
    }
  }

  function addStage() {
    setDraft((prev) => ({
      ...prev,
      stages: [
        ...prev.stages,
        {
          ref: `stage_${prev.stages.length + 1}`,
          agent: 'build',
          type: 'single',
        },
      ],
    }))
  }

  function updateStage(index: number, patch: Partial<WorkflowDraft['stages'][number]>) {
    setDraft((prev) => {
      const stages = prev.stages.map((stage, stageIndex) => {
        if (stageIndex !== index) return stage
        return {
          ...stage,
          ...patch,
        }
      })
      return { ...prev, stages }
    })
  }

  function removeStage(index: number) {
    setDraft((prev) => ({
      ...prev,
      stages: prev.stages.filter((_, stageIndex) => stageIndex !== index),
    }))
  }

  async function submit() {
    const toSave = editorMode === 'yaml' ? await parseYaml(yamlText) : draft
    const errors = validateWorkflowDraft(toSave)
    if (errors.length > 0) {
      setYamlError(errors.join('; '))
      return
    }

    setIsSaving(true)
    try {
      await onSave(toSave)
      onClose()
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="xl"
      title={mode === 'create' ? 'New Workflow' : 'Edit Workflow'}
      description="Use builder mode or raw YAML mode"
    >
      <div className="space-y-4">
        <SegmentedToggle
          value={editorMode}
          onChange={setEditorMode}
          tone="neutral"
          size="xs"
          className="w-fit"
          ariaLabel="Workflow editor mode"
          items={[
            { value: 'builder', label: 'Builder' },
            { value: 'yaml', label: 'YAML' },
          ]}
        />

        {editorMode === 'builder' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">
                <span className="text-fg-2">Workflow ID</span>
                <input
                  value={draft.id}
                  onChange={(event) => setDraft((prev) => ({ ...prev, id: event.target.value.trim() }))}
                  disabled={mode === 'edit'}
                  className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-sm)] text-sm text-fg-0 disabled:opacity-60"
                />
              </label>

              <label className="space-y-1 text-sm md:col-span-1">
                <span className="text-fg-2">Description</span>
                <input
                  value={draft.description}
                  onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
                  className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-sm)] text-sm text-fg-0"
                />
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-fg-0">Stages</div>
                <Button type="button" onClick={addStage} variant="secondary" size="xs">
                  <Plus className="w-3.5 h-3.5" />
                  Add stage
                </Button>
              </div>

              <div className="space-y-2">
                {draft.stages.map((stage, index) => {
                  const isLoop = stage.type === 'loop'
                  return (
                    <div key={`${stage.ref}-${index}`} className="rounded-[var(--radius-md)] border border-bd-0 bg-bg-2 p-3 space-y-2">
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <input
                          value={stage.ref}
                          onChange={(event) => updateStage(index, { ref: event.target.value })}
                          placeholder="ref"
                          className="px-2 py-1.5 bg-bg-1 border border-bd-0 rounded text-sm"
                        />
                        <input
                          value={stage.agent}
                          onChange={(event) => updateStage(index, { agent: event.target.value })}
                          placeholder="agent"
                          className="px-2 py-1.5 bg-bg-1 border border-bd-0 rounded text-sm"
                        />
                        <SelectDropdown
                          value={stage.type ?? 'single'}
                          onChange={(nextValue) => {
                            const nextType = nextValue === 'loop' ? 'loop' : 'single'
                            updateStage(index, {
                              type: nextType,
                              loop: nextType === 'loop'
                                ? stage.loop ?? { over: 'stories', completion: 'all_done', verifyEach: true }
                                : undefined,
                            })
                          }}
                          ariaLabel={`Stage ${stage.ref || index + 1} type`}
                          tone="field"
                          size="sm"
                          search={false}
                          options={[
                            { value: 'single', label: 'single' },
                            { value: 'loop', label: 'loop' },
                          ]}
                        />
                        <Button
                          type="button"
                          onClick={() => removeStage(index)}
                          variant="secondary"
                          size="xs"
                          className="justify-center"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Remove
                        </Button>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-fg-2">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={Boolean(stage.optional)}
                            onChange={(event) => updateStage(index, { optional: event.target.checked })}
                          />
                          Optional
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={Boolean(stage.canVeto)}
                            onChange={(event) => updateStage(index, { canVeto: event.target.checked })}
                          />
                          Can veto
                        </label>
                        <input
                          value={stage.loopTarget ?? ''}
                          onChange={(event) => updateStage(index, { loopTarget: event.target.value || undefined })}
                          placeholder="loop target"
                          className="px-2 py-1.5 bg-bg-1 border border-bd-0 rounded text-sm"
                        />
                      </div>

                      {isLoop && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                          <input
                            value={stage.loop?.verifyStageRef ?? ''}
                            onChange={(event) => updateStage(index, {
                              loop: {
                                over: 'stories',
                                completion: 'all_done',
                                verifyEach: stage.loop?.verifyEach ?? true,
                                maxStories: stage.loop?.maxStories,
                                verifyStageRef: event.target.value || undefined,
                              },
                            })}
                            placeholder="verify stage ref"
                            className="px-2 py-1.5 bg-bg-1 border border-bd-0 rounded text-sm"
                          />
                          <label className="flex items-center gap-2 text-xs text-fg-2">
                            <input
                              type="checkbox"
                              checked={Boolean(stage.loop?.verifyEach)}
                              onChange={(event) => updateStage(index, {
                                loop: {
                                  over: 'stories',
                                  completion: 'all_done',
                                  verifyEach: event.target.checked,
                                  verifyStageRef: stage.loop?.verifyStageRef,
                                  maxStories: stage.loop?.maxStories,
                                },
                              })}
                            />
                            verifyEach
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={stage.loop?.maxStories ?? ''}
                            onChange={(event) => {
                              const maxStories = event.target.value ? Number(event.target.value) : undefined
                              updateStage(index, {
                                loop: {
                                  over: 'stories',
                                  completion: 'all_done',
                                  verifyEach: stage.loop?.verifyEach,
                                  verifyStageRef: stage.loop?.verifyStageRef,
                                  maxStories,
                                },
                              })
                            }}
                            placeholder="max stories"
                            className="px-2 py-1.5 bg-bg-1 border border-bd-0 rounded text-sm"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : (
          <YamlEditor
            value={yamlText}
            onChange={(value) => { void handleYamlChange(value) }}
            error={yamlError}
            height="460px"
          />
        )}

        {validationErrors.length > 0 && (
          <div className="rounded-[var(--radius-sm)] border border-status-warning/40 bg-status-warning/10 p-2 text-xs text-status-warning">
            {validationErrors.join(' | ')}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose} variant="secondary" size="sm">Cancel</Button>
          <Button type="button" onClick={() => { void submit() }} disabled={!canSave} variant="primary" size="sm">
            {isSaving ? 'Saving...' : mode === 'create' ? 'Create Workflow' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
