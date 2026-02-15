'use client'

import { useEffect, useMemo, useState } from 'react'
import { WhatsNewModal, type WhatsNewPayload } from '@/components/desktop/whats-new-modal'

function getDesktopBridge(): {
  getWhatsNew?: () => Promise<WhatsNewPayload | null>
  ackWhatsNew?: (version: string) => Promise<{ ok: boolean }>
  openExternalUrl?: (url: string) => Promise<{ ok: boolean; message?: string }>
} | null {
  if (typeof window === 'undefined') return null
  return window.clawcontrolDesktop ?? null
}

export function DesktopStartupModals() {
  const bridge = useMemo(() => getDesktopBridge(), [])
  const [whatsNew, setWhatsNew] = useState<WhatsNewPayload | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    const getWhatsNew = bridge?.getWhatsNew
    if (!getWhatsNew) return

    async function probe(getWhatsNewFn: () => Promise<WhatsNewPayload | null>) {
      // Retry briefly in case Electron main is still fetching release metadata.
      for (let i = 0; i < 10; i++) {
        if (cancelled) return
        const payload = await getWhatsNewFn().catch(() => null)
        if (cancelled) return
        if (payload) {
          setWhatsNew(payload)
          setOpen(true)
          return
        }
        await new Promise((r) => setTimeout(r, 750))
      }
    }

    void probe(getWhatsNew)

    return () => {
      cancelled = true
    }
  }, [bridge])

  const handleClose = async () => {
    const payload = whatsNew
    setOpen(false)
    setWhatsNew(null)
    if (!payload) return
    if (!bridge?.ackWhatsNew) return
    await bridge.ackWhatsNew(payload.version).catch(() => {})
  }

  const handleOpenRelease = async () => {
    const payload = whatsNew
    if (!payload) return
    const url = payload.releaseUrl
    if (!url) return

    if (bridge?.openExternalUrl) {
      await bridge.openExternalUrl(url).catch(() => {})
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <WhatsNewModal
      open={open}
      payload={whatsNew}
      onClose={handleClose}
      onOpenRelease={handleOpenRelease}
    />
  )
}
