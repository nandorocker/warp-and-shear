# Warp & Shear

Type the text, stack distortion effects, export outlined SVG or PNG.

```bash
npm install
npm run dev
```

## Text markup

| Markup | Effect |
| --- | --- |
| `*word*` | highlight color (may span lines). ⌘B / Ctrl+B wraps the selection |
| `^` at line start | one size step bigger (`^^` = two). Step ratio is in **Type** |
| `~` at line start | one size step smaller |
| `\*` `\^` `\~` | literal character |

Shortcuts outside the textarea: **R** randomize, **M** mutate.

## How it works

1. **Layout** (`src/core/layout.ts`): glyph outlines from opentype.js, flattened into
   finely subdivided polylines so non-linear warps bend straight stems too.
2. **Effects** (`src/core/effects.ts`): each effect is a point function
   `(x, y, frame) → [x, y]`. It runs in a fixed order: Jitter → Shear → Envelope → Cloth.
   **Scope** picks the frame: the whole block, each line, or each glyph. The frame
   is the current bounds of that element, so effects compose the way Illustrator
   envelopes do.
3. **Render** (`src/core/render.ts`): paths grouped per line, highlight via fill.

### Adding an effect

Add an `EffectDef` to `EFFECTS` with `defaults`, `controls` (min/max/step/options and an
optional `random` range) and `make(params) → PointFn`. Add its params type to
`EffectsState`. The panel, Randomize and Mutate pick it up automatically.

### Adding a font

opentype.js can't apply variable-font axes, so fonts are baked to static instances
by `scripts/build-fonts.sh` (needs `uv`). Add an instancer line there, then add an
entry in `FONTS` (`src/state.ts`).

Fonts (SIL OFL, licenses in `public/fonts/`):
- DM Sans: wght 1000, opsz 40
- Outfit: wght 600
- Archivo: wght 900, wdth 75
