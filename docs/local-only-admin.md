# Local-only Admin Tools (Security Requirement)

Mission Control and the OpenClaw Dashboard are **admin consoles**.
They must **never** be exposed to LAN or the public internet.

## Mission Control
- Must bind only to **127.0.0.1** (loopback)
- Must not listen on `0.0.0.0` or any `192.168.x.x` interface
- Refuses to start if `HOST`/`HOSTNAME` is set to a non-loopback value

### Local access
- http://127.0.0.1:3000

### Remote access (explicit, user-initiated)
Use SSH port forwarding:

```bash
ssh -L 3000:127.0.0.1:3000 user@host
```

Then open locally:
- http://127.0.0.1:3000

## OpenClaw Dashboard
- Must remain bound to **127.0.0.1:18789** (and/or `::1:18789`)
- Remote access is allowed only via SSH tunnel

```bash
ssh -L 18789:127.0.0.1:18789 user@host
```

Then open locally:
- http://127.0.0.1:18789

## Never allowed
- Reverse proxies (nginx/caddy) that expose these ports
- ngrok / cloudflared / “tailscale serve”
- Automatic HTTPS exposure
- CORS configurations that enable cross-origin remote use

## Verification
On the host machine:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN   # EXPECT: 127.0.0.1:3000 only
lsof -nP -iTCP:18789 -sTCP:LISTEN  # EXPECT: 127.0.0.1:18789 and/or [::1]:18789 only
```

If either shows `0.0.0.0`, this is **not compliant**.
