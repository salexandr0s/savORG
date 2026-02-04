#!/bin/bash
# =============================================================================
# clawcontrol Stop Script
# =============================================================================
# Stops all clawcontrol processes (backend and Mac app).
# =============================================================================

echo "Stopping clawcontrol..."

# Stop Next.js backend
pkill -f "next start" 2>/dev/null && echo "  ✓ Backend stopped" || echo "  - Backend not running"

# Stop Mac app
pkill -f "clawcontrol.app" 2>/dev/null && echo "  ✓ Mac app stopped" || echo "  - Mac app not running"

echo ""
echo "clawcontrol stopped."
