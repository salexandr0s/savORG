import { describe, expect, it } from 'vitest'
import { classifyErrorSignature, extractSuggestedCliCommand } from '@/lib/openclaw/error-classifier'

describe('error-classifier', () => {
  it('classifies known context-limit signatures deterministically', () => {
    const classification = classifyErrorSignature({
      signatureText: '<ts> [memory] sync failed: Input is longer than the context size',
      sample: 'Input is longer than the context size. Try to increase context size.',
    })

    expect(classification.category).toBe('context_limit')
    expect(classification.detectability).toBe('deterministic')
    expect(classification.actionable).toBe(true)
    expect(classification.suggestedActions.length).toBeGreaterThan(0)
  })

  it('falls back to unknown classification for unmatched signatures', () => {
    const classification = classifyErrorSignature({
      signatureText: 'weird.custom.signature.thing',
      sample: 'unexpected payload in plugin subsystem',
    })

    expect(classification.category).toBe('unknown')
    expect(classification.detectability).toBe('unknown')
    expect(classification.confidence).toBeLessThan(0.5)
  })

  it('extracts and maps suggested remediation command from error lines', () => {
    const command = extractSuggestedCliCommand('Config mismatch detected. Run: openclaw doctor --fix')
    const classification = classifyErrorSignature({
      signatureText: '<ts> Config warnings',
      sample: 'Run: openclaw doctor --fix',
    })

    expect(command).toBe('openclaw doctor --fix')

    const maintenanceAction = classification.suggestedActions.find((action) => action.kind === 'maintenance')
    expect(maintenanceAction?.maintenanceAction).toBe('doctor-fix')
  })
})
