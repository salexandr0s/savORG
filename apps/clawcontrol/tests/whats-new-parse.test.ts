import { describe, expect, it } from 'vitest'
import { extractReleaseHighlights } from '../../clawcontrol-desktop/electron/whats-new'

describe('whats-new highlight extraction', () => {
  it('prefers the Highlights section when present', () => {
    const body = `
# v0.11.0

## Highlights
- New package scanner during import
- Trust badges across the UI

## Installation
- irrelevant
    `.trim()

    expect(extractReleaseHighlights(body)).toEqual([
      'New package scanner during import',
      'Trust badges across the UI',
    ])
  })

  it('falls back to first bullet lines when no Highlights section', () => {
    const body = `
Changelog
- One
- Two
- Three
    `.trim()

    expect(extractReleaseHighlights(body)).toEqual(['One', 'Two', 'Three'])
  })

  it('falls back to first non-empty non-heading lines when no bullets', () => {
    const body = `
## Title

First line.

Second line.

Third line.
    `.trim()

    expect(extractReleaseHighlights(body)).toEqual(['First line.', 'Second line.', 'Third line.'])
  })
})

