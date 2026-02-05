#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"

INPUT_PNG="$REPO_ROOT/assets/logo-icon.png"
OUT_DIR="$DESKTOP_DIR/assets"

if [[ ! -f "$INPUT_PNG" ]]; then
  echo "Input logo not found: $INPUT_PNG" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

echo "Generating icons from: $INPUT_PNG"

# Linux icon (PNG)
cp "$INPUT_PNG" "$OUT_DIR/icon.png"

# macOS icon (.icns)
# NOTE: `iconutil` rejects PNGs produced by `sips` on some macOS versions.
# We generate an `.icns` directly from a 512x512 PNG via `sips` instead.
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

sips -z 512 512 "$INPUT_PNG" --out "$TMP_DIR/icon_512.png" >/dev/null
sips -s format icns "$TMP_DIR/icon_512.png" --out "$OUT_DIR/icon.icns" >/dev/null

# Windows icon (.ico) - embed PNG frames via python (no Pillow/ImageMagick dependency)
ICO_PNG_DIR="$TMP_DIR/ico-png"
mkdir -p "$ICO_PNG_DIR"

declare -a ICO_SIZES=(16 32 48 256)
for size in "${ICO_SIZES[@]}"; do
  sips -z "$size" "$size" "$INPUT_PNG" --out "$ICO_PNG_DIR/${size}.png" >/dev/null
done

python3 - "$OUT_DIR/icon.ico" "$ICO_PNG_DIR/16.png" "$ICO_PNG_DIR/32.png" "$ICO_PNG_DIR/48.png" "$ICO_PNG_DIR/256.png" <<'PY'
import struct
import sys
from pathlib import Path

out_path = Path(sys.argv[1])
png_paths = [Path(p) for p in sys.argv[2:]]

images = []
sizes = []
for p in png_paths:
  data = p.read_bytes()
  images.append(data)
  # sizes are encoded in filename (e.g. 16.png)
  sizes.append(int(p.stem))

count = len(images)
header = struct.pack("<HHH", 0, 1, count)

entries = []
offset = 6 + 16 * count
data_blob = b""

for size, img in zip(sizes, images):
  w = 0 if size == 256 else size
  h = 0 if size == 256 else size
  entry = struct.pack(
    "<BBBBHHII",
    w,
    h,
    0,  # colorCount
    0,  # reserved
    0,  # planes
    0,  # bitCount
    len(img),
    offset,
  )
  entries.append(entry)
  offset += len(img)
  data_blob += img

out_path.write_bytes(header + b"".join(entries) + data_blob)
print(f"Wrote {out_path} ({out_path.stat().st_size} bytes)")
PY

echo "Done:"
ls -la "$OUT_DIR" | sed -n '1,120p'
