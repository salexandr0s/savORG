'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { EmptyState, TypedConfirmModal } from '@clawcontrol/ui'
import { CanonicalTable, type Column } from '@/components/ui/canonical-table'
import { RightDrawer } from '@/components/shell/right-drawer'
import { Modal } from '@/components/ui/modal'
import { ImportPackageModal } from '@/components/packages/import-package-modal'
import { agentTeamsApi, packagesApi, type AgentTeamSummary } from '@/lib/http'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { useSettings } from '@/lib/settings-context'
import { cn } from '@/lib/utils'
import { Download, Plus, Trash2, Upload } from 'lucide-react'

const teamColumns: Column<AgentTeamSummary>[] = [
  {
    key: 'name',
    header: 'Team',
    width: '220px',
    render: (row) => (
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-status-success" />
        <span className="text-fg-0">{row.name}</span>
      </div>
    ),
  },
  {
    key: 'source',
    header: 'Source',
    width: '90px',
    mono: true,
    render: (row) => row.source,
  },
  {
    key: 'memberCount',
    header: 'Members',
    width: '70px',
    align: 'center',
    mono: true,
    render: (row) => row.memberCount,
  },
  {
    key: 'workflowIds',
    header: 'Workflows',
    width: '80px',
    align: 'center',
    mono: true,
    render: (row) => row.workflowIds.length,
  },
  {
    key: 'updatedAt',
    header: 'Updated',
    width: '100px',
    align: 'right',
    render: (row) => <span className="text-xs text-fg-2">{new Date(row.updatedAt).toLocaleDateString()}</span>,
  },
]

interface TeamEditorDraft {
  id?: string
  name: string
  description: string
  workflowIdsText: string
  templateIdsText: string
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function toDraft(team: AgentTeamSummary | null): TeamEditorDraft {
  if (!team) {
    return {
      name: '',
      description: '',
      workflowIdsText: '',
      templateIdsText: '',
    }
  }

  return {
    id: team.id,
    name: team.name,
    description: team.description ?? '',
    workflowIdsText: team.workflowIds.join(', '),
    templateIdsText: team.templateIds.join(', '),
  }
}

interface TeamEditorModalProps {
  open: boolean
  mode: 'create' | 'edit'
  draft: TeamEditorDraft
  onClose: () => void
  onChange: (next: TeamEditorDraft) => void
  onSubmit: () => Promise<void>
  isSubmitting: boolean
}

function TeamEditorModal({
  open,
  mode,
  draft,
  onClose,
  onChange,
  onSubmit,
  isSubmitting,
}: TeamEditorModalProps) {
  const canSubmit = draft.name.trim().length > 0 && !isSubmitting

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="lg"
      title={mode === 'create' ? 'New Team' : 'Edit Team'}
      description="Team metadata and linked workflow/template ids"
    >
      <div className="space-y-3">
        <label className="space-y-1 text-sm block">
          <span className="text-fg-2">Name</span>
          <input
            value={draft.name}
            onChange={(event) => onChange({ ...draft, name: event.target.value })}
            className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-sm)] text-sm text-fg-0"
          />
        </label>

        <label className="space-y-1 text-sm block">
          <span className="text-fg-2">Description</span>
          <textarea
            value={draft.description}
            onChange={(event) => onChange({ ...draft, description: event.target.value })}
            rows={3}
            className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-sm)] text-sm text-fg-0"
          />
        </label>

        <label className="space-y-1 text-sm block">
          <span className="text-fg-2">Workflow IDs (comma-separated)</span>
          <input
            value={draft.workflowIdsText}
            onChange={(event) => onChange({ ...draft, workflowIdsText: event.target.value })}
            className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-sm)] text-sm text-fg-0"
          />
        </label>

        <label className="space-y-1 text-sm block">
          <span className="text-fg-2">Template IDs (comma-separated)</span>
          <input
            value={draft.templateIdsText}
            onChange={(event) => onChange({ ...draft, templateIdsText: event.target.value })}
            className="w-full px-3 py-2 bg-bg-2 border border-bd-0 rounded-[var(--radius-sm)] text-sm text-fg-0"
          />
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-secondary" type="button">Cancel</button>
          <button
            onClick={() => { void onSubmit() }}
            disabled={!canSubmit}
            className={cn('btn-primary', !canSubmit && 'opacity-60')}
            type="button"
          >
            {isSubmitting ? 'Saving...' : mode === 'create' ? 'Create Team' : 'Save Changes'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function TeamsTab() {
  const { skipTypedConfirm } = useSettings()
  const protectedAction = useProtectedAction({ skipTypedConfirm })

  const [teams, setTeams] = useState<AgentTeamSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = useMemo(() => teams.find((item) => item.id === selectedId) ?? null, [teams, selectedId])

  const [showEditor, setShowEditor] = useState(false)
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create')
  const [draft, setDraft] = useState<TeamEditorDraft>(toDraft(null))
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [showPackageImport, setShowPackageImport] = useState(false)

  const fetchTeams = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await agentTeamsApi.list()
      setTeams(result.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load teams')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchTeams()
  }, [fetchTeams])

  const openCreate = () => {
    setEditorMode('create')
    setDraft(toDraft(null))
    setShowEditor(true)
  }

  const openEdit = () => {
    if (!selected) return
    setEditorMode('edit')
    setDraft(toDraft(selected))
    setShowEditor(true)
  }

  const saveTeam = async () => {
    setIsSubmitting(true)
    setError(null)

    const payload = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      workflowIds: parseCommaSeparated(draft.workflowIdsText),
      templateIds: parseCommaSeparated(draft.templateIdsText),
    }

    try {
      if (editorMode === 'create') {
        await new Promise<void>((resolve, reject) => {
          protectedAction.trigger({
            actionKind: 'team.create',
            actionTitle: 'Create Team',
            actionDescription: `Create team ${payload.name}`,
            entityName: payload.name,
            onConfirm: async (typedConfirmText) => {
              try {
                await agentTeamsApi.create({ ...payload, typedConfirmText })
                resolve()
              } catch (err) {
                reject(err)
                throw err
              }
            },
            onError: reject,
          })
        })
      } else if (selected) {
        await new Promise<void>((resolve, reject) => {
          protectedAction.trigger({
            actionKind: 'team.edit',
            actionTitle: 'Edit Team',
            actionDescription: `Update team ${selected.name}`,
            entityName: selected.name,
            onConfirm: async (typedConfirmText) => {
              try {
                await agentTeamsApi.update(selected.id, { ...payload, typedConfirmText })
                resolve()
              } catch (err) {
                reject(err)
                throw err
              }
            },
            onError: reject,
          })
        })
      }

      setShowEditor(false)
      await fetchTeams()
      setNotice(editorMode === 'create' ? 'Team created' : 'Team updated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save team')
    } finally {
      setIsSubmitting(false)
    }
  }

  const deleteTeam = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'team.delete',
      actionTitle: 'Delete Team',
      actionDescription: `Delete team ${selected.name}`,
      entityName: selected.name,
      onConfirm: async (typedConfirmText) => {
        await agentTeamsApi.delete(selected.id, { typedConfirmText })
        setSelectedId(null)
        await fetchTeams()
        setNotice('Team deleted')
      },
      onError: (err) => setError(err.message),
    })
  }

  const exportTeam = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'team.export',
      actionTitle: 'Export Team',
      actionDescription: `Export team ${selected.name} as YAML`,
      entityName: selected.name,
      onConfirm: async (typedConfirmText) => {
        const blob = await agentTeamsApi.export(selected.id, typedConfirmText)
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${selected.slug || selected.id}.team.yaml`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
        setNotice('Team exported')
      },
      onError: (err) => setError(err.message),
    })
  }

  const exportTeamPackage = () => {
    if (!selected) return

    protectedAction.trigger({
      actionKind: 'package.export',
      actionTitle: 'Export Team Package',
      actionDescription: `Export ${selected.name} as .clawpack.zip`,
      entityName: selected.name,
      onConfirm: async (typedConfirmText) => {
        const blob = await packagesApi.export(selected.id, 'team_with_workflows', typedConfirmText)
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = `${selected.slug || selected.id}.clawpack.zip`
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
        setNotice('Team package exported')
      },
      onError: (err) => setError(err.message),
    })
  }

  if (loading) {
    return <div className="p-6 text-sm text-fg-2">Loading teams…</div>
  }

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-fg-2">{teams.length} teams configured</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPackageImport(true)}
              className="btn-secondary inline-flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              Import Package
            </button>
            <button type="button" onClick={openCreate} className="btn-primary inline-flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5" />
              New Team
            </button>
          </div>
        </div>

        {notice && (
          <div className="rounded-[var(--radius-sm)] border border-status-success/40 bg-status-success/10 text-status-success text-sm p-2">
            {notice}
          </div>
        )}

        {error && (
          <div className="rounded-[var(--radius-sm)] border border-status-danger/40 bg-status-danger/10 text-status-danger text-sm p-2">
            {error}
          </div>
        )}

        <div className="bg-bg-2 rounded-[var(--radius-lg)] border border-bd-0 overflow-hidden">
          <CanonicalTable
            columns={teamColumns}
            rows={teams}
            rowKey={(row) => row.id}
            onRowClick={(row) => setSelectedId(row.id)}
            selectedKey={selectedId ?? undefined}
            density="compact"
            emptyState={
              <EmptyState
                title="No teams"
                description="Create a team to group agents and linked workflows."
              />
            }
          />
        </div>
      </div>

      <RightDrawer
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        title={selected?.name || 'Team'}
        description={selected?.description || selected?.slug || ''}
      >
        {selected && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Members:</span> <span className="text-fg-1">{selected.memberCount}</span></div>
              <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Health:</span> <span className="text-fg-1">{selected.healthStatus}</span></div>
              <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Workflows:</span> <span className="text-fg-1">{selected.workflowIds.length}</span></div>
              <div className="rounded bg-bg-2 p-2"><span className="text-fg-2">Templates:</span> <span className="text-fg-1">{selected.templateIds.length}</span></div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-fg-2">Workflow IDs</div>
              <div className="text-xs text-fg-1 font-mono">{selected.workflowIds.join(', ') || 'none'}</div>
            </div>

            <div className="space-y-1">
              <div className="text-xs text-fg-2">Members</div>
              <div className="space-y-1">
                {selected.members.map((member) => (
                  <div key={member.id} className="text-xs text-fg-1 rounded bg-bg-2 px-2 py-1">
                    {member.displayName} · {member.role}
                  </div>
                ))}
                {selected.members.length === 0 && (
                  <div className="text-xs text-fg-2">No members assigned</div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button type="button" onClick={openEdit} className="btn-secondary">Edit</button>
              <button type="button" onClick={exportTeam} className="btn-secondary inline-flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" />
                Export
              </button>
              <button type="button" onClick={exportTeamPackage} className="btn-secondary inline-flex items-center gap-1.5">
                <Download className="w-3.5 h-3.5" />
                Export Package
              </button>
              <button type="button" onClick={deleteTeam} className="btn-secondary inline-flex items-center gap-1.5 text-status-danger">
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </div>
          </div>
        )}
      </RightDrawer>

      <TeamEditorModal
        open={showEditor}
        mode={editorMode}
        draft={draft}
        onClose={() => setShowEditor(false)}
        onChange={setDraft}
        onSubmit={saveTeam}
        isSubmitting={isSubmitting}
      />

      <ImportPackageModal
        open={showPackageImport}
        onClose={() => setShowPackageImport(false)}
        onDeployed={fetchTeams}
      />

      <TypedConfirmModal
        isOpen={protectedAction.state.isOpen}
        onClose={protectedAction.cancel}
        onConfirm={protectedAction.confirm}
        actionTitle={protectedAction.state.actionTitle}
        actionDescription={protectedAction.state.actionDescription}
        confirmMode={protectedAction.confirmMode}
        riskLevel={protectedAction.riskLevel}
        entityName={protectedAction.state.entityName}
        isLoading={protectedAction.state.isLoading}
      />
    </>
  )
}
