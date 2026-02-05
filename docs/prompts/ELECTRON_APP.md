# ELECTRON_APP.md

## Goal
Replace the Swift/SwiftUI Mac app with an Electron wrapper, and fix the health check performance issue.

## Current State
- Web app at `apps/clawcontrol/` (Next.js, working fine)
- Swift Mac app at `apps/clawcontrol-mac/` (causes performance issues, requires Xcode)
- Logo at `assets/logo-icon.png` and `apps/clawcontrol/public/images/logo-icon.png`
- Health check issue: `/api/maintenance` returns ~9KB every 2-10 seconds, causing system slowdown

## Tasks

### 1. Remove Swift App
Delete the `apps/clawcontrol-mac/` directory entirely.

### 2. Create Electron App
Create `apps/clawcontrol-desktop/` with:

```
apps/clawcontrol-desktop/
├── package.json
├── tsconfig.json
├── electron/
│   ├── main.ts          # Main process
│   ├── preload.ts       # Preload script
│   └── utils.ts         # Helper functions
├── assets/
│   ├── icon.icns        # macOS icon (generate from logo-icon.png)
│   ├── icon.ico         # Windows icon
│   └── icon.png         # Linux icon (copy from assets/logo-icon.png)
├── scripts/
│   └── build-icons.sh   # Script to generate .icns/.ico from PNG
└── README.md
```

**package.json requirements:**
```json
{
  "name": "clawcontrol-desktop",
  "version": "0.1.0",
  "main": "dist/main.js",
  "scripts": {
    "dev": "electron .",
    "build": "tsc && electron-builder",
    "build:mac": "tsc && electron-builder --mac",
    "build:win": "tsc && electron-builder --win",
    "build:linux": "tsc && electron-builder --linux"
  },
  "build": {
    "appId": "com.clawcontrol.desktop",
    "productName": "ClawControl",
    "mac": {
      "icon": "assets/icon.icns",
      "category": "public.app-category.developer-tools"
    },
    "win": {
      "icon": "assets/icon.ico"
    },
    "linux": {
      "icon": "assets/icon.png"
    }
  },
  "devDependencies": {
    "electron": "^29.0.0",
    "electron-builder": "^24.0.0",
    "typescript": "^5.0.0"
  }
}
```

**main.ts requirements:**
- Create BrowserWindow pointing to `http://127.0.0.1:3000`
- Set app icon from assets
- Handle app ready, window-all-closed, activate events
- Set reasonable default window size (1200x800)
- Enable devTools in development only
- Add menu bar with standard items (File, Edit, View, Window, Help)

**preload.ts:**
- Minimal preload, expose nothing sensitive
- Can add IPC bridge later if needed

### 3. Fix Health Check Performance Issue

The `/api/maintenance` endpoint returns too much data too frequently.

**File:** `apps/clawcontrol/app/api/maintenance/route.ts`

**Changes needed:**
1. **Reduce payload size** — only return essential status fields, not full agent/session details
2. **Add caching** — cache response for 30 seconds, return cached version for subsequent requests
3. **Make polling interval configurable** — expose `MAINTENANCE_POLL_INTERVAL_MS` env var (default 30000ms instead of 2000ms)

**Suggested response structure (lean):**
```typescript
{
  status: 'ok' | 'degraded' | 'error',
  agentCount: number,
  activeAgents: number,
  pendingApprovals: number,
  lastSync: string, // ISO timestamp
  version: string
}
```

**If there's a client-side polling component**, find it and:
- Reduce default interval to 30s
- Use exponential backoff on errors
- Skip poll when tab is not visible

### 4. Update start.sh
Modify `start.sh` to support new `--desktop` flag:
```bash
./start.sh --desktop  # Start web server + launch Electron app
./start.sh --web      # Start web server only (current behavior)
```

### 5. Update stop.sh
Add logic to kill Electron process if running.

### 6. Generate Icons
Create `scripts/build-icons.sh` that:
- Takes `assets/logo-icon.png` as input
- Generates `icon.icns` for macOS (using `iconutil` or `png2icns`)
- Generates `icon.ico` for Windows (using ImageMagick or similar)
- Copies PNG for Linux

Run this script and commit the generated icons.

### 7. Update README.md
Add section on desktop app:
```markdown
## Desktop App (Electron)

Build the desktop app:
\`\`\`bash
cd apps/clawcontrol-desktop
npm install
npm run build:mac  # or build:win, build:linux
\`\`\`

The built app will be in `apps/clawcontrol-desktop/dist/`.
```

### 8. Update Root package.json
Add workspace entry for the new desktop app if using npm workspaces.

## Testing
1. Run `./start.sh --web` — verify web app works at http://127.0.0.1:3000
2. Run `cd apps/clawcontrol-desktop && npm run dev` — verify Electron window opens and loads the web app
3. Check that health check no longer causes performance issues (monitor CPU/memory)
4. Build `.app` with `npm run build:mac` — verify it launches and has correct icon

## Files to Delete
- `apps/clawcontrol-mac/` (entire directory)

## Files to Create
- `apps/clawcontrol-desktop/package.json`
- `apps/clawcontrol-desktop/tsconfig.json`
- `apps/clawcontrol-desktop/electron/main.ts`
- `apps/clawcontrol-desktop/electron/preload.ts`
- `apps/clawcontrol-desktop/assets/icon.icns`
- `apps/clawcontrol-desktop/assets/icon.ico`
- `apps/clawcontrol-desktop/assets/icon.png`
- `apps/clawcontrol-desktop/scripts/build-icons.sh`
- `apps/clawcontrol-desktop/README.md`

## Files to Modify
- `apps/clawcontrol/app/api/maintenance/route.ts` — fix payload size + caching
- `start.sh` — add --desktop flag
- `stop.sh` — handle Electron process
- `README.md` — document desktop app
- `package.json` (root) — add workspace if needed
