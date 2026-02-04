# Tool Policy Matrix

This matrix maps each agent to its allowed tools. Use this as the source of truth for OpenClaw `tools.allow`/`tools.deny` settings.

| Agent | Allowed Tools | Notes |
| --- | --- | --- |
| Guard | none | No tools; classification only. |
| CEO | full (allowlist) | Dispatch + oversight only. |
| Manager | sessions only | Dispatch-only; no file access. |
| Research | read, web_search, web_fetch | Read-only + web access. |
| Plan | read | Read-only for context. |
| PlanReview | read | Read-only for context. |
| Build | coding (allowlist) | Write access + local commands. |
| UI | coding (allowlist) | Write access + local commands. |
| BuildReview | read, exec (allowlist) | May run `npm test`, `npm run typecheck`, `npm run lint`; never modifies files. |
| UIReview | minimal; exec = deny | Read-only review; request audit results if needed. |
| Ops | full (allowlist) | Cron + automation. |
| Security | minimal; exec = deny | Audit-only; no execution. |

Recommended denylists:
- Deny `gateway` and `message` for all non-CEO agents.
- Deny `group:automation` for all except Ops.
- Deny `group:web` for all except Research.
- Deny `group:exec` for Security, Plan, PlanReview, and UIReview.
