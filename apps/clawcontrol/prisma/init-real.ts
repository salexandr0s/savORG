import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  // Clear demo data
  await prisma.activity.deleteMany()
  await prisma.approval.deleteMany()
  await prisma.receipt.deleteMany()
  await prisma.artifact.deleteMany()
  await prisma.message.deleteMany()
  await prisma.operation.deleteMany()
  await prisma.workOrder.deleteMany()
  await prisma.agentSession.deleteMany()
  await prisma.agent.deleteMany()
  await prisma.station.deleteMany()
  await prisma.cronJob.deleteMany()
  
  // Create real stations
  const stations = await Promise.all([
    prisma.station.create({ data: { id: 'plan', name: 'Planning', icon: 'clipboard-list', sortOrder: 1 } }),
    prisma.station.create({ data: { id: 'build', name: 'Build', icon: 'hammer', sortOrder: 2 } }),
    prisma.station.create({ data: { id: 'review', name: 'Review', icon: 'search-check', sortOrder: 3 } }),
    prisma.station.create({ data: { id: 'security', name: 'Security', icon: 'shield', sortOrder: 4 } }),
  ])
  
  // Create real agents
  const agents = await Promise.all([
    prisma.agent.create({ data: { 
      name: 'SavorgPlan', 
      role: 'planner',
      station: 'plan',
      sessionKey: 'savorgplan',
      status: 'idle',
    }}),
    prisma.agent.create({ data: { 
      name: 'SavorgPlanReview', 
      role: 'reviewer',
      station: 'review',
      sessionKey: 'savorgplanreview',
      status: 'idle',
    }}),
    prisma.agent.create({ data: { 
      name: 'SavorgBuild', 
      role: 'builder',
      station: 'build',
      sessionKey: 'savorgbuild',
      status: 'idle',
    }}),
    prisma.agent.create({ data: { 
      name: 'SavorgBuildReview', 
      role: 'reviewer',
      station: 'review',
      sessionKey: 'savorgbuildreview',
      status: 'idle',
    }}),
    prisma.agent.create({ data: { 
      name: 'SavorgSecurity', 
      role: 'security',
      station: 'security',
      sessionKey: 'savorgsecurity',
      status: 'idle',
    }}),
    prisma.agent.create({ data: { 
      name: 'SavorgManager', 
      role: 'manager',
      station: 'plan',
      sessionKey: 'savorgmanager',
      status: 'idle',
    }}),
    prisma.agent.create({ data: { 
      name: 'SavorgResearch', 
      role: 'researcher',
      station: 'plan',
      sessionKey: 'savorgresearch',
      status: 'idle',
    }}),
  ])
  
  // Create first real work order
  const wo = await prisma.workOrder.create({
    data: {
      code: 'WO-0001',
      title: 'Implement OpenClaw auto-discovery',
      goalMd: `Add auto-detection of local OpenClaw config so ClawControl finds gateway URL, token, and agents automatically.

## Acceptance Criteria
- discoverLocalConfig() reads ~/.openclaw/openclaw.json
- GET /api/openclaw/discover returns connection status and agent list  
- On app startup, agents from OpenClaw are synced to the database
- Settings page shows auto-detected connection status

## Implementation Prompt
~/clawd/projects/savORG/docs/prompts/OPENCLAW_AUTODISCOVERY.md`,
      state: 'planned',
      priority: 'P2',
      owner: 'user',
    }
  })
  
  console.log('✓ Cleared demo data')
  console.log(`✓ Created ${stations.length} stations`)
  console.log(`✓ Created ${agents.length} agents`)
  console.log(`✓ Created work order: ${wo.code} - ${wo.title}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
