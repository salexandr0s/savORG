import 'server-only'

import { prisma } from '@/lib/db'

export async function isFirstRun(): Promise<boolean> {
  const count = await prisma.agent.count()
  return count === 0
}
