# ClawControl Desktop (Electron)

This is a lightweight Electron wrapper around the existing ClawControl web app.

## Prereqs
- The backend (Next.js) must be running at `http://127.0.0.1:3000`.

## Generate icons
```bash
./scripts/build-icons.sh
```

## Dev
```bash
# In repo root, start backend:
./start.sh --web

# In another terminal, start Electron:
npm run dev --workspace=clawcontrol-desktop
```

## Build
```bash
npm run build:mac --workspace=clawcontrol-desktop
# or: build:win, build:linux
```

Artifacts will be emitted under `apps/clawcontrol-desktop/dist/release/`.

