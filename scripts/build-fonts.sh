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

# One file per weight, named <Family>-<weight>.ttf. Keep these lists in sync with FONTS in src/state.ts.
mkdir -p public/fonts
for w in 400 500 600 700 800 900; do
  inst "$SRC/outfit.ttf"  wght=$w            -o "public/fonts/Outfit-$w.ttf"
  inst "$SRC/archivo.ttf" wght=$w wdth=75    -o "public/fonts/ArchivoCondensed-$w.ttf"
done
for w in 400 500 600 700 800 900 1000; do
  inst "$SRC/dmsans.ttf"  wght=$w opsz=40    -o "public/fonts/DMSans-$w.ttf"
done
cp "$SRC"/OFL-*.txt public/fonts/
