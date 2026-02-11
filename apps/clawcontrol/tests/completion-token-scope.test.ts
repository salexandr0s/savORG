import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('completion token uniqueness scope', () => {
  it('uses operation-scoped unique key for completion tokens', () => {
    const schemaPath = join(process.cwd(), 'prisma', 'schema.prisma')
    const schema = readFileSync(schemaPath, 'utf8')

    expect(schema).toContain('model OperationCompletionToken')
    expect(schema).toContain('@@unique([operationId, token])')
    expect(schema).not.toContain('token       String   @unique')
  })
})
