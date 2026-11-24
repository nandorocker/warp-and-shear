# Warp & Shear ✨

A tiny playground for turning text into wiggly, wonderfully warped lettering. Type a phrase, layer on distortion, then export it as SVG or PNG.

## Get started

```sh
npm install
npm run dev
```

Open the local URL printed by Vite and start making something lovely.

## A little text magic

| Type this | Get this |
| --- | --- |
| `*word*` | Highlighted text (can span lines); select text and press **⌘B** / **Ctrl+B** to wrap it |
| `^` at the start of a line | One size step up; `^^` means two |
| `~` at the start of a line | One size step down |
| `\*`, `\^`, `\~` | A literal character |

Shortcuts (outside the text area): **R** randomize, **M** nudge. Anywhere: **⌘Z** / **⇧⌘Z** undo and redo, **⌘S** save the current look as a preset, **⌘O** import presets, **⌘E** export SVG, **⇧⌘E** export PNG (Ctrl instead of ⌘ on Windows and Linux). Inside the text area, **⌘Z** undoes typing. Everything else is undoable from the nav bar.

## Under the hood

Built with TypeScript, Vite, opentype.js, and Tweakpane. Effects are applied in order: Jitter → Shear → Envelope → Cloth. Their scope can be the whole block, a line, or an individual glyph.

### Add a font

Fonts are baked into static instances by `scripts/build-fonts.sh` (requires [uv](https://docs.astral.sh/uv/)). Each family is baked once per weight (`<Family>-<weight>.ttf`): add it to the loops there and register the family, its weights and its default weight in `FONTS` in `src/state.ts`. Font licenses are in `public/fonts/`.

### Add an effect

Add an `EffectDef` to `EFFECTS` in `src/core/effects.ts` and its parameter type to `EffectsState`. The panel and randomize/mutate actions pick it up automatically.

## License

Font files are distributed under the SIL Open Font License; see the license files in `public/fonts/`. The application code has no license specified yet.

## Made by

**Nando Rossi** · [nan.do](https://nan.do) · [@nandorocker](https://twitter.com/nandorocker)
