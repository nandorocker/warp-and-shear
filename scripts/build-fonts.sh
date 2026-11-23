#!/usr/bin/env bash
# Rebuilds the static font instances in public/fonts from the Google Fonts
# variable sources. opentype.js can't apply variable-font axes, so we bake
# each face to a fixed instance (and remove contour overlaps so exported SVG
# outlines are clean). Requires `uv`.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="${FONT_SRC_DIR:-$(mktemp -d)}"
BASE=https://github.com/google/fonts/raw/main/ofl
fetch() { [ -f "$SRC/$2" ] || curl -sSL -o "$SRC/$2" "$BASE/$1"; }

fetch 'outfit/Outfit%5Bwght%5D.ttf'          outfit.ttf
fetch 'dmsans/DMSans%5Bopsz,wght%5D.ttf'      dmsans.ttf
fetch 'archivo/Archivo%5Bwdth,wght%5D.ttf'    archivo.ttf
fetch 'outfit/OFL.txt'  OFL-Outfit.txt
fetch 'dmsans/OFL.txt'  OFL-DMSans.txt
fetch 'archivo/OFL.txt' OFL-Archivo.txt

inst() {
  uvx --from fonttools --with skia-pathops fonttools varLib.instancer \
    --remove-overlaps --update-name-table "$@"
}

mkdir -p public/fonts
inst "$SRC/outfit.ttf"  wght=600            -o public/fonts/Outfit-SemiBold.ttf
inst "$SRC/dmsans.ttf"  wght=1000 opsz=40   -o public/fonts/DMSans-Black-Display.ttf
inst "$SRC/archivo.ttf" wght=900  wdth=75   -o public/fonts/Archivo-Black-Condensed.ttf
cp "$SRC"/OFL-*.txt public/fonts/
