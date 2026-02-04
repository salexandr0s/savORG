#!/bin/bash
set -e
cd "$(dirname "$0")"

CONFIG="${1:-Release}"

echo "Building ClawHub ($CONFIG)..."
# Force deterministic output path for CI packaging
xcodebuild -project ClawHub.xcodeproj \
  -scheme ClawHub \
  -configuration "$CONFIG" \
  -derivedDataPath build \
  -destination 'platform=macOS' \
  build \
  | grep -E "^(Build|Compiling|Linking|\*\*)" || true

echo ""
echo "Built: build/Build/Products/$CONFIG/ClawHub.app"
echo "Run:   open build/Build/Products/$CONFIG/ClawHub.app"
