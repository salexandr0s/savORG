#!/bin/bash
# =============================================================================
# clawcontrol Stop Script
# =============================================================================
# Stops all clawcontrol processes (backend and desktop app).
# =============================================================================

echo "Stopping clawcontrol..."

# Stop Next.js backend
pkill -f "next start" 2>/dev/null && echo "  ✓ Backend stopped" || echo "  - Backend not running"

# Stop desktop app (Electron)
if pkill -f "--workspace=clawcontrol-desktop" 2>/dev/null || pkill -f "apps/clawcontrol-desktop" 2>/dev/null; then
  echo "  ✓ Desktop app stopped"
else
  echo "  - Desktop app not running"
fi

echo ""
echo "clawcontrol stopped."
