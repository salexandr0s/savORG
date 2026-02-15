export interface WhatsNewPayload {
  version: string
  title: string
  publishedAt: string | null
  highlights: string[]
  releaseUrl: string
}

function normalizeLines(input: string): string[] {
  return input.replace(/\r\n/g, '\n').split('\n')
}

function cleanupBullet(text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  // Strip leading bullet markers.
  const withoutMarker = trimmed.replace(/^[-*•]\s+/, '')
  // Collapse whitespace.
  return withoutMarker.replace(/\s+/g, ' ').trim()
}

export function extractReleaseHighlights(body: string | null | undefined, maxItems = 8): string[] {
  if (typeof body !== 'string' || body.trim().length === 0) return []

  const lines = normalizeLines(body)

  // Prefer "## Highlights" (or "### Highlights") section if present.
  const highlightsHeaderIdx = lines.findIndex((line) => /^#{2,3}\s+highlights\b/i.test(line.trim()))
  if (highlightsHeaderIdx !== -1) {
    const out: string[] = []
    for (let i = highlightsHeaderIdx + 1; i < lines.length; i++) {
      const line = lines[i] ?? ''
      const trimmed = line.trim()
      if (!trimmed) continue
      if (/^#{2,3}\s+/.test(trimmed)) break
      if (/^```/.test(trimmed)) continue
      if (/^[-*•]\s+/.test(trimmed)) {
        const bullet = cleanupBullet(trimmed)
        if (bullet) out.push(bullet)
      }
      if (out.length >= maxItems) break
    }
    if (out.length > 0) return out
  }

  // Fallback: first N bullet lines anywhere in the body.
  {
    const out: string[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!/^[-*•]\s+/.test(trimmed)) continue
      const bullet = cleanupBullet(trimmed)
      if (!bullet) continue
      out.push(bullet)
      if (out.length >= maxItems) break
    }
    if (out.length > 0) return out
  }

  // Final fallback: first few non-empty, non-heading lines.
  {
    const out: string[] = []
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (/^#{1,6}\s+/.test(trimmed)) continue
      if (/^```/.test(trimmed)) continue
      out.push(trimmed.replace(/\s+/g, ' '))
      if (out.length >= Math.min(3, maxItems)) break
    }
    return out
  }
}

export function buildWhatsNewPayload(input: {
  version: string
  title: string
  publishedAt: string | null
  body: string | null | undefined
  releaseUrl: string
}): WhatsNewPayload {
  const highlights = extractReleaseHighlights(input.body)
  return {
    version: input.version,
    title: input.title,
    publishedAt: input.publishedAt,
    highlights: highlights.length > 0 ? highlights : ['No highlights were published for this release.'],
    releaseUrl: input.releaseUrl,
  }
}

