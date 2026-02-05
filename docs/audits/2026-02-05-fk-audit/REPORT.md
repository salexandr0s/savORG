# FK Audit: Hardcoded Foreign-Key IDs (WorkOrder)

Date: 2026-02-05

## Scope

Audit `apps/clawcontrol/` for patterns where required FK fields are set to hardcoded/sentinel string IDs (or default to them), most critically:

- `Receipt.workOrderId` → `WorkOrder.id` (required FK)

## Findings (Potential FK Violations)

The following API routes create receipts with a reserved `workOrderId` (`'system'` or `'console'`). These will trigger `Foreign key constraint violated` if the corresponding `WorkOrder` record is missing in the DB.

Source list: `docs/audits/2026-02-05-fk-audit/grep_workOrderId_system_console_any2.txt`

### `workOrderId: 'system'` (Receipt FK → WorkOrder.id)

- `apps/clawcontrol/app/api/stations/route.ts:125`
- `apps/clawcontrol/app/api/stations/[id]/route.ts:85`
- `apps/clawcontrol/app/api/stations/[id]/route.ts:173`
- `apps/clawcontrol/app/api/security/audit/route.ts:131`
- `apps/clawcontrol/app/api/plugins/restart/route.ts:51`
- `apps/clawcontrol/app/api/plugins/route.ts:162`
- `apps/clawcontrol/app/api/plugins/[id]/config/route.ts:98`
- `apps/clawcontrol/app/api/plugins/[id]/doctor/route.ts:49`
- `apps/clawcontrol/app/api/plugins/[id]/route.ts:154`
- `apps/clawcontrol/app/api/agents/create-from-template/route.ts:114`
- `apps/clawcontrol/app/api/agents/[id]/provision/route.ts:57`
- `apps/clawcontrol/app/api/agents/[id]/test/route.ts:39`
- `apps/clawcontrol/app/api/agents/create/route.ts:89`
- `apps/clawcontrol/app/api/playbooks/[id]/run/route.ts:75` (defaults to `'system'`)
- `apps/clawcontrol/app/api/maintenance/[action]/route.ts:138`
- `apps/clawcontrol/app/api/maintenance/recover/route.ts:75`
- `apps/clawcontrol/app/api/maintenance/recover/route.ts:193`
- `apps/clawcontrol/app/api/maintenance/recover/route.ts:237`
- `apps/clawcontrol/app/api/maintenance/recover/route.ts:276`
- `apps/clawcontrol/app/api/agent-templates/route.ts:83`
- `apps/clawcontrol/app/api/agent-templates/[id]/route.ts:87`
- `apps/clawcontrol/app/api/agent-templates/[id]/export/route.ts:46`
- `apps/clawcontrol/app/api/agent-templates/import/route.ts:154`

### `workOrderId: 'console'` / default-to-console (Receipt FK → WorkOrder.id)

- `apps/clawcontrol/app/api/openclaw/console/agent/turn/route.ts:138`
- `apps/clawcontrol/app/api/openclaw/console/sessions/[id]/chat/route.ts:126` (defaults to `'console'`)
- `apps/clawcontrol/app/api/openclaw/console/sessions/[id]/send/route.ts:124` (defaults to `'console'`)

## Fix Implemented

### 1) Startup bootstrap (existing DBs)

Added an idempotent startup upsert to guarantee reserved work orders exist even when seed scripts were never run:

- `apps/clawcontrol/lib/db.ts` exports `ensureReservedWorkOrders()`
- `apps/clawcontrol/instrumentation.ts` calls it at Node.js startup (after `enableWalMode()`)

This prevents UI/API actions that create receipts from failing with FK violations on databases that are missing the reserved work orders.

### 2) Seed coverage (fresh DBs)

Updated seed data to create the missing reserved work order used by console routes:

- `apps/clawcontrol/prisma/seed.ts` now seeds `WorkOrder{id:'console', code:'WO-CONSOLE', ...}`

(`'system'`/`WO-SYS` was already seeded.)

## Recommended Follow-ups (Non-blocking)

- Centralize reserved IDs (e.g. `SYSTEM_WORK_ORDER_ID`, `CONSOLE_WORK_ORDER_ID`) and replace ad-hoc string literals.
- For routes that accept a `workOrderId` from user input, validate existence before insert to return a clearer 4xx (instead of a Prisma FK error).

## Verification

- Typecheck: `npm run typecheck --workspace=clawcontrol`
- Log: `docs/audits/2026-02-05-fk-audit/typecheck.log`
