# REMOVE_MOCK_DATA.md

## Goal
Completely remove all mock data generation and seeding from ClawControl. Users should only ever see their own real data — never placeholder/demo content.

## Rationale
- ClawControl is a production orchestration tool, not a demo
- Mock data creates confusion ("is this real?")
- Users connect to their own OpenClaw instance — that IS the data source
- Empty states are preferable to fake data

## Tasks

### 1. Remove Seed Script
- [ ] Delete `apps/clawcontrol/prisma/seed.ts`
- [ ] Remove `db:seed` script from `apps/clawcontrol/package.json`
- [ ] Remove seed invocation from `setup.sh` and `start.sh`

### 2. Remove Mock Data from Database Schema
Review and clean these tables — keep structure, remove any default/seed values:
- [ ] `WorkOrder` — no demo work orders
- [ ] `Operation` — no demo operations  
- [ ] `Agent` — agents come from OpenClaw discovery only
- [ ] `Station` — stations come from OpenClaw discovery only
- [ ] `Activity` — real activities only
- [ ] `CronJob` — real cron jobs only (synced from OpenClaw)
- [ ] `Skill` — real skills only (synced from OpenClaw)
- [ ] `Plugin` — real plugins only
- [ ] `Approval` — real approvals only
- [ ] `Settings` — keep defaults, but no mock user data

### 3. Remove Mock API Endpoints
Search for and remove any mock/demo endpoints:
- [ ] Any `/api/**/mock` routes
- [ ] Any `?mock=true` query param handling
- [ ] Any `MOCK_MODE` or `DEMO_MODE` environment variables

### 4. Update Repository Layer
In `apps/clawcontrol/lib/repo/`:
- [ ] Remove any hardcoded fallback data
- [ ] Remove any "if no data, return mock" patterns
- [ ] Ensure all repos return empty arrays/null when no real data exists

### 5. Update UI for Empty States
Replace mock data fallbacks with proper empty states:
- [ ] Dashboard — "Connect to OpenClaw to see your agents"
- [ ] Agents page — "No agents discovered. Check OpenClaw connection."
- [ ] Work Orders — "No work orders yet. Create one to get started."
- [ ] Console — "No active sessions. Sessions appear when agents are running."
- [ ] Cron — "No scheduled jobs. Sync with OpenClaw to import jobs."

### 6. Update Initialization Flow
In `apps/clawcontrol/instrumentation.ts` and `prisma/init-real.ts`:
- [ ] Remove any seed/mock data initialization
- [ ] Keep only: WAL mode, FTS indexes, reserved system records (like WO-SYS)
- [ ] Ensure clean boot with empty database

### 7. Documentation
- [ ] Update README — remove any "demo mode" references
- [ ] Update setup instructions — clarify data comes from OpenClaw
- [ ] Remove any screenshots showing mock data

## Files to Audit

```
apps/clawcontrol/
├── prisma/
│   ├── seed.ts              # DELETE
│   └── init-real.ts         # AUDIT - keep system records only
├── lib/repo/
│   ├── agents.ts            # AUDIT
│   ├── work-orders.ts       # AUDIT
│   ├── operations.ts        # AUDIT
│   ├── cron.ts              # AUDIT
│   └── ...                  # AUDIT all
├── app/api/                  # AUDIT for mock endpoints
└── package.json             # Remove db:seed script

setup.sh                     # Remove seed invocation
start.sh                     # Remove seed invocation
```

## Acceptance Criteria

1. Fresh install shows empty dashboard with helpful empty states
2. No demo/mock data appears anywhere in the UI
3. All data comes from:
   - OpenClaw gateway (agents, sessions, cron jobs, skills)
   - User actions (work orders, operations, approvals)
4. Database migrations still work (structure preserved)
5. `npm run db:seed` command no longer exists
6. No `MOCK_MODE`, `DEMO_MODE`, or similar env vars

## Notes

- Keep the `WO-SYS` system work order — it's needed for FK constraints on system operations
- Keep `Settings` defaults (UI preferences, etc.) — these aren't mock data
- FTS indexes should still be created on boot
- Empty arrays are fine — the UI should handle them gracefully
