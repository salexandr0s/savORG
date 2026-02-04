#!/bin/bash
set -e
cd "$(dirname "$0")"

CONFIG="${1:-Release}"

echo "Building ClawHub ($CONFIG)..."
xcodebuild -project ClawHub.xcodeproj \
  -scheme ClawHub \
  -configuration "$CONFIG" \
  build \
  | grep -E "^(Build|Compiling|Linking|\*\*)" || true

echo ""
echo "Built: build/$CONFIG/ClawHub.app"
echo "Run:   open build/$CONFIG/ClawHub.app"
