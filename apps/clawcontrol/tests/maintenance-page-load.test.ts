import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('maintenance page load behavior', () => {
  it('uses probe-first loading and parallelizes initial data fetches', async () => {
    const file = join(
      process.cwd(),
      'app',
      '(dashboard)',
      'maintenance',
      'page.tsx'
    )
    const source = await readFile(file, 'utf8')

    expect(source).toContain('getGatewayProbe')
    expect(source).toMatch(/Promise\.all\(\[\s*getGatewayProbe\(\),\s*listPlaybooks\(\),?\s*\]\)/)
  })
})
