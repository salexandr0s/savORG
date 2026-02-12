'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { X, Save, FileCode, AlertCircle } from 'lucide-react'
import { LoadingSpinner, LoadingState } from '@/components/ui/loading-state'
import { workspaceApi } from '@/lib/http'
import { Button, TypedConfirmModal } from '@clawcontrol/ui'
import { useProtectedAction } from '@/lib/hooks/useProtectedAction'
import { useSettings } from '@/lib/settings-context'
import type { ActionKind } from '@clawcontrol/core'

interface FileEditorModalProps {
  isOpen: boolean
  onClose: () => void
  filePath: string // e.g., "/agents/agent-build.md"
  fileName: string // e.g., "agent-build.md"
  onSaved?: () => void
}

// Protected files require confirmation
const PROTECTED_FILES: Record<string, ActionKind> = {
  'AGENTS.md': 'config.agents_md.edit',
  'routing.yaml': 'config.routing_template.edit',
}

function encodeWorkspacePathId(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const bytes = new TextEncoder().encode(normalizedPath)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function FileEditorModal({
  isOpen,
  onClose,
  filePath,
  fileName,
  onSaved,
}: FileEditorModalProps) {
  const { skipTypedConfirm } = useSettings()
  const [content, setContent] = useState('')
  const [originalContent, setOriginalContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const protectedAction = useProtectedAction({ skipTypedConfirm })

  // Determine if this is a protected file
  const isProtected = Object.keys(PROTECTED_FILES).some((f) => fileName.endsWith(f))
  const actionKind = Object.entries(PROTECTED_FILES).find(([f]) => fileName.endsWith(f))?.[1]

  // Load file content
  useEffect(() => {
    if (!isOpen) return

    async function loadFile() {
      setLoading(true)
      setError(null)
      try {
        // Encode the path to get the file ID
        const fileId = encodeWorkspacePathId(filePath)
        const result = await workspaceApi.get(fileId)
        setContent(result.data.content || '')
        setOriginalContent(result.data.content || '')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file')
      } finally {
        setLoading(false)
      }
    }

    loadFile()
  }, [isOpen, filePath])

  const hasChanges = content !== originalContent

  const handleSave = async (typedConfirmText?: string) => {
    if (!hasChanges) return

    setSaving(true)
    setError(null)

    try {
      const fileId = encodeWorkspacePathId(filePath)
      await workspaceApi.update(fileId, { content, typedConfirmText })
      setOriginalContent(content)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file')
      throw err
    } finally {
      setSaving(false)
    }
  }

  const handleSaveClick = () => {
    if (isProtected && actionKind) {
      protectedAction.trigger({
        actionKind,
        actionTitle: `Edit ${fileName}`,
        actionDescription: `Save changes to protected file ${fileName}`,
        entityName: fileName,
        onConfirm: handleSave,
      })
    } else {
      handleSave()
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* In-page overlay modal */}
      <div className="absolute inset-0 z-50">
        <button
          type="button"
          onClick={onClose}
          className="absolute inset-0 bg-black/[0.45] backdrop-blur-[1px]"
          aria-label="Close editor"
        />

        <div className="absolute inset-2 sm:inset-4 md:inset-6 flex flex-col rounded-[var(--radius-lg)] border border-bd-0 bg-bg-0 shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-bd-0 bg-bg-1">
            <div className="flex items-center gap-3 min-w-0">
              <FileCode className="w-5 h-5 text-fg-2 shrink-0" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-fg-0 truncate">{fileName}</h2>
                <p className="text-xs text-fg-3 truncate">{filePath}</p>
              </div>
              {isProtected && (
                <span className="px-2 py-0.5 text-[10px] uppercase tracking-wide bg-status-warning/10 text-status-warning rounded shrink-0">
                  Protected
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSaveClick}
                disabled={!hasChanges || saving}
                variant={hasChanges ? 'primary' : 'secondary'}
                size="md"
                className={cn(!hasChanges && 'text-fg-3')}
              >
                {saving ? (
                  <LoadingSpinner size="md" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Save
              </Button>
              <button
                onClick={onClose}
                className="p-2 hover:bg-bg-3 rounded-[var(--radius-md)] text-fg-2 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-2 bg-status-danger/10 text-status-danger text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          {/* Editor */}
          <div className="flex-1 overflow-hidden">
            {loading ? (
              <LoadingState height="full" />
            ) : (
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full h-full p-4 font-mono text-sm bg-bg-0 text-fg-0 border-none outline-none resize-none"
                spellCheck={false}
              />
            )}
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-bd-0 bg-bg-1 text-xs text-fg-3">
            <span>{content.split('\n').length} lines</span>
            <span>{hasChanges ? 'Modified' : 'Saved'}</span>
          </div>
        </div>
      </div>

      {/* Confirmation modal */}
      <TypedConfirmModal
        isOpen={protectedAction.state.isOpen}
        onClose={protectedAction.cancel}
        onConfirm={protectedAction.confirm}
        actionTitle={protectedAction.state.actionTitle}
        actionDescription={protectedAction.state.actionDescription}
        confirmMode={protectedAction.confirmMode}
        riskLevel={protectedAction.riskLevel}
        workOrderCode={protectedAction.state.workOrderCode}
        entityName={protectedAction.state.entityName}
        isLoading={protectedAction.state.isLoading}
      />
    </>
  )
}
