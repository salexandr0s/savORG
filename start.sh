#!/bin/bash
# =============================================================================
# clawcontrol Launcher
# =============================================================================
# Starts the backend server and optionally launches the desktop app.
#
# Usage:
#   ./start.sh             # Start backend + desktop (Electron)
#   ./start.sh --desktop   # Start backend + desktop (Electron)
#   ./start.sh --web       # Start backend only (use browser at localhost:3000)
#
# =============================================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLAWCONTROL_DIR="$SCRIPT_DIR/apps/clawcontrol"
BACKEND_DIR="$SCRIPT_DIR/apps/clawcontrol"
DESKTOP_DIR="$SCRIPT_DIR/apps/clawcontrol-desktop"
DATA_DIR="$CLAWCONTROL_DIR/data"
DB_FILE="$DATA_DIR/clawcontrol.db"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo ""
echo "╔═══════════════════════════════════════╗"
echo "║          clawcontrol Launcher         ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# Parse arguments
MODE="desktop"

for arg in "$@"; do
  case $arg in
    --desktop)
      MODE="desktop"
      ;;
    --web)
      MODE="web"
      ;;
    --help|-h)
      echo "Usage: ./start.sh [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --desktop  Start backend + desktop app (Electron)"
      echo "  --web      Start backend only (use browser)"
      echo "  --help     Show this help message"
      echo ""
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option:${NC} $arg"
      echo "Run ./start.sh --help for usage."
      exit 1
      ;;
  esac
done

# Check desktop app exists (if desktop mode)
if [[ "$MODE" == "desktop" ]] && [[ ! -d "$DESKTOP_DIR" ]]; then
  echo -e "${RED}Desktop app not found at:${NC}"
  echo "  $DESKTOP_DIR"
  echo ""
  echo "Expected workspace: apps/clawcontrol-desktop/"
  exit 1
fi

# Check if dependencies are installed
if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  echo -e "${YELLOW}Installing dependencies...${NC}"
  cd "$SCRIPT_DIR"
  npm install
elif [[ "$MODE" == "desktop" ]] && [[ ! -d "$SCRIPT_DIR/node_modules/electron" ]]; then
  echo -e "${YELLOW}Electron dependencies missing. Installing...${NC}"
  cd "$SCRIPT_DIR"
  npm install
fi

# Check if database exists
if [[ ! -f "$DB_FILE" ]]; then
  echo -e "${YELLOW}Database not found. Running setup...${NC}"
  "$SCRIPT_DIR/setup.sh"
fi

# Start backend
echo -e "${YELLOW}Starting backend server...${NC}"
cd "$BACKEND_DIR"
npm run start &
BACKEND_PID=$!
DESKTOP_PID=""

# Cleanup function
cleanup() {
  echo ""
  echo -e "${YELLOW}Shutting down...${NC}"
  kill $BACKEND_PID 2>/dev/null || true
  if [[ -n "$DESKTOP_PID" ]]; then
    kill "$DESKTOP_PID" 2>/dev/null || true
  fi
  echo -e "${GREEN}clawcontrol stopped.${NC}"
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# Wait for backend to be ready
echo "Waiting for backend..."
READY=false
for i in {1..30}; do
  if curl -s http://127.0.0.1:3000/api/maintenance > /dev/null 2>&1; then
    READY=true
    break
  fi
  sleep 1
  echo -n "."
done
echo ""

if [[ "$READY" != "true" ]]; then
  echo -e "${RED}Backend failed to start within 30 seconds.${NC}"
  echo "Check the logs above for errors."
  exit 1
fi

echo -e "${GREEN}Backend ready at http://127.0.0.1:3000${NC}"

# Launch desktop app or show browser instructions
if [[ "$MODE" == "web" ]]; then
  echo ""
  echo -e "${GREEN}clawcontrol is running!${NC}"
  echo "Open http://localhost:3000 in your browser."
  echo ""
  echo "Press Ctrl+C to stop."
else
  echo ""
  echo -e "${YELLOW}Launching desktop app (Electron)...${NC}"
  cd "$SCRIPT_DIR"
  npm run dev --workspace=clawcontrol-desktop &
  DESKTOP_PID=$!
  echo -e "${GREEN}clawcontrol is running!${NC}"
  echo ""
  echo "Press Ctrl+C (or close the window) to stop."
fi

# Keep script running
if [[ "$MODE" == "desktop" ]]; then
  wait "$DESKTOP_PID"
else
  wait "$BACKEND_PID"
fi
