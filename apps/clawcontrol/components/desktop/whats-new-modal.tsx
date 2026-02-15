'use client'

import { Modal } from '@/components/ui/modal'
import { Button } from '@clawcontrol/ui'
import { ExternalLink } from 'lucide-react'

export type WhatsNewPayload = {
  version: string
  title: string
  publishedAt: string | null
  highlights: string[]
  releaseUrl: string
}

export function WhatsNewModal(props: {
  open: boolean
  payload: WhatsNewPayload | null
  onClose: () => void
  onOpenRelease: () => void
}) {
  if (!props.open || !props.payload) return null

  const publishedLabel = props.payload.publishedAt
    ? new Date(props.payload.publishedAt).toLocaleString()
    : null

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={`What’s New • v${props.payload.version}`}
      description={props.payload.title}
    >
      <div className="space-y-4">
        {publishedLabel ? (
          <div className="text-xs text-fg-2 font-mono">Published: {publishedLabel}</div>
        ) : null}

        <div className="rounded-[var(--radius-md)] border border-bd-0 bg-bg-2 p-4">
          <div className="text-xs font-medium text-fg-0 mb-2">Highlights</div>
          <ul className="list-disc pl-5 space-y-1 text-sm text-fg-1">
            {props.payload.highlights.slice(0, 8).map((line, idx) => (
              <li key={`${idx}-${line.slice(0, 24)}`}>{line}</li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={props.onOpenRelease}>
            <ExternalLink className="w-3.5 h-3.5" />
            Open Release
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={props.onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  )
}
