#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ASSETS="$ROOT/store/assets"
ICONS="$ROOT/extension/icons"
SCREENSHOTS="$ASSETS/screenshots"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
VERSION="$(rg -o '"version": "([^"]+)"' -r '$1' "$ROOT/extension/manifest.json")"

if [[ ! -x "$CHROME" ]]; then
  echo "error: Google Chrome not found at $CHROME" >&2
  exit 1
fi

mkdir -p "$ICONS" "$SCREENSHOTS" "$ROOT/dist"

# Renders an SVG at exact pixel dimensions. qlmanage cannot be used here because
# it only produces aspect-fitted thumbnails padded inside a square canvas.
# content_w/content_h default to the canvas size; smaller values add centered
# transparent padding, which the Chrome Web Store expects for the store icon.
render_svg() {
  local svg="$1" out="$2" canvas_w="$3" canvas_h="$4"
  local content_w="${5:-$3}" content_h="${6:-$4}"
  local pad_x=$(( (canvas_w - content_w) / 2 ))
  local pad_y=$(( (canvas_h - content_h) / 2 ))
  local dir
  dir="$(mktemp -d "/tmp/zero-tab-render.XXXXXX")"

  cat > "$dir/render.html" <<HTML
<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  img { display: block; width: ${content_w}px; height: ${content_h}px; margin: ${pad_y}px ${pad_x}px; }
</style>
<img src="file://${svg}" alt="">
HTML

  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --default-background-color=00000000 \
    --window-size="${canvas_w},${canvas_h}" \
    --screenshot="$out" \
    "file://$dir/render.html" >/dev/null 2>&1

  rm -rf "$dir"
}

capture_screenshot() {
  local page="$1" out="$2"
  "$CHROME" \
    --headless=new \
    --disable-gpu \
    --hide-scrollbars \
    --force-device-scale-factor=1 \
    --window-size=1280,800 \
    --screenshot="$out" \
    "file://$page" >/dev/null 2>&1
}

echo "Generating extension icons..."
render_svg "$ICONS/icon.svg" "$ICONS/icon128.png" 128 128
render_svg "$ICONS/icon.svg" "$ICONS/icon48.png" 48 48
# The detailed window artwork loses legibility in the toolbar, so 16px uses the
# simplified single-glyph variant.
render_svg "$ICONS/icon-small.svg" "$ICONS/icon16.png" 16 16

echo "Generating store icon and promo tile..."
render_svg "$ICONS/icon.svg" "$ASSETS/zero-tab-icon-128.png" 128 128 96 96
render_svg "$ASSETS/zero-tab-promo-440x280.svg" "$ASSETS/zero-tab-promo-440x280.png" 440 280

echo "Capturing store screenshots..."
capture_screenshot "$SCREENSHOTS/mock-dashboard-light.html" "$SCREENSHOTS/zero-tab-dashboard-1280x800.png"
capture_screenshot "$SCREENSHOTS/mock-dashboard-dark.html" "$SCREENSHOTS/zero-tab-report-dark-1280x800.png"

echo "Building Web Store ZIP..."
npm --prefix "$ROOT" run build
rm -f "$ROOT/dist/zero-tab-webstore-$VERSION.zip"
# Stage the compiled MV3 extension so source files and local configuration
# never leak into the Web Store package.
STAGE="$(mktemp -d "/tmp/zero-tab-package.XXXXXX")/extension"
mkdir -p "$STAGE"
rsync -a \
  --exclude ".DS_Store" \
  --exclude "icons/*.svg" \
  "$ROOT/dist/extension/" "$STAGE/"
(
  cd "$STAGE"
  zip -qr "$ROOT/dist/zero-tab-webstore-$VERSION.zip" .
)
rm -rf "$(dirname "$STAGE")"

echo "Done."
echo "Icons:       $ICONS"
echo "Store icon:  $ASSETS/zero-tab-icon-128.png"
echo "Promo:       $ASSETS/zero-tab-promo-440x280.png"
echo "Screenshots: $SCREENSHOTS"
echo "Package:     $ROOT/dist/zero-tab-webstore-$VERSION.zip"
