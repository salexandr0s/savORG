# OpenClaw Integration Guide

## Purpose
This guide wires Savorg agent policy into OpenClaw using per-agent heartbeats and tool allowlists.

## Heartbeats
- Configure heartbeats via `agents.defaults.heartbeat` or per-agent `agents.list[].heartbeat`.
- `every: "0m"` disables heartbeats without removing the prompt.
- The per-agent heartbeat prompts in `openclaw/openclaw.json5` point to `agents/<agent>/HEARTBEAT.md`.
- Savorg is event-driven; only the CEO heartbeat is enabled by default.

## Per-Agent SOUL/HEARTBEAT Loading
Use one of these patterns to ensure agent-specific files are applied:

Option A (recommended)
- Inject `agents/<agent>/SOUL.md` and `agents/<agent>/HEARTBEAT.md` into each agent's system prompt at spawn time.

Option B
- Allow `read` for that agent and keep heartbeat prompts that instruct reading the file.

Option C
- Assign per-agent workspaces that point to `agents/<agent>/` for read-only agents only.

## Tool Policy
- Use `docs/tool-policy-matrix.md` as the allowlist source of truth.
- Apply allowlists and denylists per agent in OpenClaw `tools.allow`/`tools.deny`.
- Reviewers are read-only by default; deny `exec` and require test/audit results as artifacts.
- `openclaw/openclaw.json5` is a template; map any placeholder fields to your actual OpenClaw schema.

## Sandbox (optional)
- Use sandboxing for Build, UI, Ops, BuildReview, and Security.
- Prefer read-only workspace access for reviewers.
- Keep network disabled by default and enable only when needed for dependency installs.
