# Agent Template System

This workspace now supports name-agnostic agent generation from tracked templates.

## What It Generates

- Role prompts: `agents/<role>.md`
- Per-agent SOUL/HEARTBEAT: `agents/<role>/SOUL.md`, `agents/<role>/HEARTBEAT.md`
- Global files: `AGENTS.md`, `SOUL.md`, `HEARTBEAT.md`, `agents/SOUL.md`, `agents/HEARTBEAT.md`
- Runtime config: `clawcontrol.config.yaml`

## Template Sources

- `templates/roles/*.template.md`
- `templates/agent/SOUL.template.md`
- `templates/agent/HEARTBEAT.template.md`
- `templates/config/clawcontrol.config.template.yaml`
- `templates/config/agent-entry.template.yaml`
- `templates/global/*.template.md`

## Variables

Supported placeholders in templates:

- `{{PREFIX}}`
- `{{PREFIX_CAPITALIZED}}`
- `{{ROLE}}`
- `{{ROLE_CAPITALIZED}}`
- `{{AGENT_ID}}`
- `{{AGENT_NAME}}`
- `{{EMOJI}}`

## Usage

### CLI (prefix argument)

```bash
./scripts/init-agents.sh acme --force
```

### CLI (manifest)

```bash
./scripts/init-agents.sh --manifest agents-manifest.example.yaml --force
```

### npm script

```bash
npm run init:agents -- --manifest agents-manifest.example.yaml --force
```

## Prefix Behavior

Prefix is optional:

- With prefix `acme`: IDs like `acmebuild`, names like `AcmeBuild`
- Without prefix: IDs like `build`, names like `Build`

Default is no prefix unless `--prefix` or a manifest prefix is provided.

## Manifest Options

- `prefix`: lowercase prefix (optional)
- `owner`: owner string for config
- `roles.<role>.enabled`: boolean to include/exclude a role
- `roles.<role>.emoji`: override default emoji
- `roles.<role>.model_tier`: override model tier
- `roles.<role>.permissions`: merge permission overrides
- `heartbeat.global`: extra global heartbeat checks

## Safety and Validation

The generator validates:

- required templates exist
- manifest YAML syntax
- unresolved template placeholders
- existing output files (`--force` required to overwrite)

Use `--dry-run` to preview writes.
