# Implementation Checklist

1. Wire agent-specific SOUL/HEARTBEAT into agent prompts.
2. Apply tool allowlists and denylists from `docs/tool-policy-matrix.md`.
3. Configure OpenClaw agent settings using `openclaw/openclaw.json5` as a template.
4. Set heartbeat schedules (CEO only by default; `every: 1h`).
5. Verify Security veto and workflow gates in the orchestrator layer.
6. Run a dry-run flow to confirm stage ordering and permissions.
