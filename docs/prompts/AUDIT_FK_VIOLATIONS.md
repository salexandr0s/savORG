# Audit Prompt: Foreign Key Hardcoded IDs

## Problem Found

In `apps/clawcontrol/app/api/stations/[id]/route.ts`, the code was creating receipts with:
```typescript
const receipt = await repos.receipts.create({
  workOrderId: 'system',  // BUG: hardcoded string, not a real FK
  ...
})
```

This caused `Foreign key constraint violated` errors because:
- `Receipt.workOrderId` is a required FK to `WorkOrder.id`
- No `WorkOrder` with `id: 'system'` existed
- Prisma enforces referential integrity

## Task

Audit the entire codebase for similar patterns where:

1. **Hardcoded string IDs are used for foreign key fields**
2. **Repos create records with FK references that may not exist**
3. **System/internal operations assume certain records exist without checking**

## Files to Check

```bash
# Find all repo create/update calls
grep -rn "repos\.\w\+\.create\|repos\.\w\+\.update" apps/clawcontrol/

# Find all prisma create calls
grep -rn "prisma\.\w\+\.create\|prisma\.\w\+\.upsert" apps/clawcontrol/

# Find hardcoded 'system' or similar sentinel values
grep -rn "'system'\|\"system\"\|'internal'\|\"internal\"" apps/clawcontrol/
```

## Schema Reference

Check `apps/clawcontrol/prisma/schema.prisma` for all FK relationships:

```prisma
// Models with required FKs (most likely to cause issues):
Receipt.workOrderId     → WorkOrder.id (required)
Receipt.operationId     → Operation.id (optional)
Operation.workOrderId   → WorkOrder.id (required)
Operation.assigneeId    → Agent.id (optional)
Approval.workOrderId    → WorkOrder.id (required)
Approval.operationId    → Operation.id (optional)
Artifact.workOrderId    → WorkOrder.id (required)
Message.workOrderId     → WorkOrder.id (required)
AgentSession.agentId    → Agent.id (required)
```

## Fix Patterns

### Pattern 1: Create a system record at DB seed time
```typescript
// In prisma/seed.ts - create once
await prisma.workOrder.upsert({
  where: { code: 'WO-SYS' },
  create: {
    id: 'system',
    code: 'WO-SYS',
    title: 'System Operations',
    goalMd: 'Internal system operations.',
    state: 'active',
    priority: 'P3',
    owner: 'clawcontrolceo',
  },
  update: {}
})
```

### Pattern 2: Make FK optional if truly optional
```prisma
// If receipts don't always need a work order:
model Receipt {
  workOrderId String? @map("work_order_id")  // Now nullable
  workOrder   WorkOrder? @relation(...)
}
```

### Pattern 3: Validate FK exists before insert
```typescript
const workOrder = await repos.workOrders.getById(workOrderId)
if (!workOrder) {
  throw new Error(`WorkOrder ${workOrderId} not found`)
}
// Then create receipt
```

## Expected Output

1. List of all files with potential FK violations
2. For each: line number, the hardcoded value, which FK it references
3. Recommended fix (use system record, make nullable, or add validation)

## Acceptance Criteria

- [ ] All hardcoded FK references identified
- [ ] `prisma/seed.ts` updated to create any needed system records
- [ ] No more `Foreign key constraint violated` errors on UI actions
- [ ] Test: Change station icon, agent assignment, create approval — all succeed
