# OpenClaw Integration

This document describes how SAVORG Mission Control integrates with [OpenClaw](https://github.com/openclaw/openclaw).

---

## Overview

OpenClaw is the CLI for orchestrating AI agents. Mission Control provides a visual interface on top of OpenClaw, enabling:

- **Visual work order management** — Track features through spec → build → QA → ship
- **Agent oversight** — Monitor agent status and execution in real-time
- **Approval gates** — Review and approve dangerous actions before execution
- **Audit trail** — Full history of all agent activities

---

## Requirements

### Supported Binary

Mission Control requires **OpenClaw** (the `openclaw` CLI):

| Requirement | Value |
|-------------|-------|
| Binary | `openclaw` |
| Minimum version | `0.1.0` |
| Install from | https://github.com/openclaw/openclaw |

> **Note:** Legacy `clawdbot` binary is not supported. If you're using clawdbot, please upgrade to OpenClaw first.

### Verification

```bash
# Check installation
which openclaw
# Should return: /usr/local/bin/openclaw (or similar)

# Check version
openclaw --version
# Should return: 0.1.0 or higher
```

### If OpenClaw Is Not Installed

When `openclaw` is not found on PATH:

- Mission Control runs in **demo mode** with mock data
- All features remain accessible for UI exploration
- No real commands are executed

---

## Command Allowlist

Mission Control only executes pre-approved commands. All commands use the `openclaw` binary.

**Current Allowlist (18 commands):**

| Command | Description | Dangerous |
|---------|-------------|-----------|
| `openclaw health [--json]` | Check gateway health | No |
| `openclaw gateway status [--json]` | Get gateway status | No |
| `openclaw gateway probe` | Probe connectivity | No |
| `openclaw doctor [--json]` | Run diagnostics | No |
| `openclaw doctor --fix` | Auto-fix issues | **Yes** |
| `openclaw gateway start` | Start gateway | No |
| `openclaw gateway stop` | Stop gateway | **Yes** |
| `openclaw gateway restart` | Restart gateway | **Yes** |
| `openclaw logs [--follow]` | View/tail logs | No |
| `openclaw security audit [--deep]` | Run security audit | No |
| `openclaw security audit --fix` | Apply safe guardrails | **Yes** |
| `openclaw status --all` | Comprehensive status | No |
| `openclaw gateway discover` | Scan for gateways | No |

See [openclaw-command-allowlist.md](audit/openclaw-command-allowlist.md) for full documentation and verification status.

### Adding New Commands

New commands must be added to the allowlist in `packages/adapters-openclaw/src/command-runner.ts`:

```typescript
export const ALLOWED_COMMANDS = {
  'health': { args: ['health'], danger: false, description: 'Check gateway health' },
  'gateway.restart': { args: ['gateway', 'restart'], danger: true, description: 'Restart the gateway' },
  // ... add new commands here
}
```

**Important:** Only add commands that are documented in official [OpenClaw docs](https://docs.openclaw.ai).

---

## Execution Model

### Safe Execution with spawn()

All commands use Node's `spawn()` with array arguments to prevent shell injection:

```typescript
import { OPENCLAW_BIN } from './resolve-bin'

// SAFE: Arguments as array
spawn(OPENCLAW_BIN, ['run', agentId, taskDescription])

// UNSAFE (never used): Shell interpolation
exec(`openclaw run ${agentId} "${taskDescription}"`)  // DON'T DO THIS
```

### Receipt Logging

Every command execution creates a receipt:

```typescript
const receipt = await repos.receipts.create({
  workOrderId: 'system',
  kind: 'manual',
  commandName: 'openclaw run',
  commandArgs: { agentId, task },
})
```

Receipts capture:
- Timestamp
- Command and arguments
- stdout/stderr streams
- Exit code
- Duration
- Parsed JSON output (if applicable)

---

## Workspace Structure

OpenClaw expects this workspace structure:

```
project-root/
├── .openclaw/
│   └── config.yaml          # OpenClaw configuration
├── agents/
│   ├── AGENTS.md            # Agent registry
│   ├── savorgBUILD.soul.md  # Agent soul file
│   └── savorgBUILD.md       # Agent overlay
├── overlays/
│   └── *.md                 # Shared overlays
├── skills/
│   ├── user/                # User-defined skills
│   └── installed/           # Installed skills
├── playbooks/
│   └── *.md                 # Automation playbooks
└── plugins/
    └── *.json               # Plugin manifests
```

### File Types

| File Type | Location | Purpose |
|-----------|----------|---------|
| Soul | `agents/<name>.soul.md` | Agent identity and core behaviors |
| Overlay | `agents/<name>.md` or `overlays/` | Custom instructions and constraints |
| Skill | `skills/` | Reusable agent capabilities |
| Playbook | `playbooks/` | Multi-step automation scripts |
| Plugin | `plugins/` | External tool integrations |

---

## Governor Policies

Mission Control enforces Governor policies before OpenClaw execution:

### Policy Types

| Policy | Description | User Action |
|--------|-------------|-------------|
| `ALLOW` | No confirmation needed | Automatic |
| `CONFIRM` | Type "CONFIRM" to proceed | Manual confirmation |
| `WO_CODE` | Type work order code | Manual confirmation |
| `DENY` | Action blocked | N/A |

### Policy Evaluation

```typescript
// apps/mission-control/lib/with-governor.ts
export async function enforceTypedConfirm(options: {
  actionKind: string
  typedConfirmText?: string
}): Promise<GovernorResult>
```

### Action Kinds

Over 60 action kinds are defined in `packages/core/src/governor/index.ts`:

```typescript
'agent.status'           // CONFIRM
'agent.create'           // CONFIRM
'plugin.install'         // CONFIRM
'work-order.advance'     // WO_CODE
'maintenance.recover'    // CONFIRM
```

---

## Activity Logging

All significant operations are logged to the activity feed:

```typescript
await repos.activities.create({
  type: 'agent.executed',
  actor: 'user',
  entityType: 'agent',
  entityId: agentId,
  summary: `Executed ${taskDescription}`,
  payloadJson: { receiptId, exitCode },
})
```

Activity types include:
- `agent.*` — Agent lifecycle and execution
- `work-order.*` — Work order state changes
- `plugin.*` — Plugin install/uninstall
- `skill.*` — Skill changes
- `template.*` — Template operations
- `maintenance.*` — System maintenance

---

## Error Handling

### OpenClaw Not Installed

When OpenClaw is not on PATH:

```typescript
// Returns mock data instead of real execution
if (!isCliAvailable()) {
  return mockCommandResult(command)
}
```

### Version Below Minimum

When OpenClaw version is below 0.1.0:

```typescript
const check = await checkOpenClaw()
if (check.belowMinVersion) {
  console.warn(check.error) // "OpenClaw version X.X.X is below minimum 0.1.0"
}
```

The system will still function but may have compatibility issues.

### Command Failures

Non-zero exit codes are captured in receipts:

```typescript
await repos.receipts.finalize(receipt.id, {
  exitCode: process.exitCode || 1,
  durationMs: elapsed,
  parsedJson: { error: stderr.trim() },
})
```

### Timeout Handling

Commands have a default 60-second timeout:

```typescript
const child = spawn('openclaw', args, {
  timeout: 60000,
})
```

---

## Demo Mode Details

When OpenClaw is unavailable, Mission Control provides:

### Mock Agents

Pre-configured agents in `packages/core/src/mocks/`:
- savorgSPEC — Specification agent
- savorgBUILD — Build/implementation agent
- savorgQA — Testing agent
- savorgOPS — Operations agent

### Mock Workspace

Virtual filesystem with sample files:
- Soul files
- Overlays
- Skills
- Playbooks

### Mock Execution

Commands return simulated results:
- Status checks return healthy
- List commands return mock data
- Run commands simulate execution with receipts

---

## Troubleshooting

### "OpenClaw not found"

1. Verify installation: `which openclaw`
2. Check PATH includes OpenClaw location
3. Restart Mission Control after installing

### "Version below minimum"

1. Check current version: `openclaw --version`
2. Upgrade OpenClaw: follow [upgrade guide](https://docs.openclaw.ai/upgrade)
3. Minimum required: 0.1.0

### "Permission denied"

1. Check file permissions on OpenClaw binary
2. Verify workspace directory is writable
3. Check SQLite database permissions

### "Command timeout"

1. Check OpenClaw is responding: `openclaw status`
2. Increase timeout in adapter if needed
3. Check for hanging agent processes

### "Invalid workspace"

1. Verify workspace structure matches expected layout
2. Create missing directories (agents/, skills/, etc.)
3. Initialize with `openclaw init` if available
