#!/bin/bash
set -e
cd "$(dirname "$0")"

CONFIG="${1:-Release}"

echo "Building clawcontrol ($CONFIG)..."
# Force deterministic output path for CI packaging
xcodebuild -project clawcontrol.xcodeproj \
  -scheme clawcontrol \
  -configuration "$CONFIG" \
  -derivedDataPath build \
  -destination 'platform=macOS' \
  build \
  | grep -E "^(Build|Compiling|Linking|\*\*)" || true

echo ""
echo "Built: build/Build/Products/$CONFIG/clawcontrol.app"
echo "Run:   open build/Build/Products/$CONFIG/clawcontrol.app"
