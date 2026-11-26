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

Built with TypeScript, Vite, opentype.js, and Tweakpane. Effects are applied in order: Jitter → Shear → Slice → Envelope → Cloth. Their scope can be the whole block, a line, or an individual glyph (Slice always works on the whole block).

**Slice warp** cuts the block into one band per line. Every band boundary is a *rail*: drag its square ends to tilt it or lean the sides, the three round pins between them to bend it (a smooth curve runs through them), or the rail itself to move it. A line stretches to fill the space between its two rails, so the edge two lines share stays one clean line however much the outer rails bend. Rails are stored by role (top, between lines, bottom), so a shape carries over when you change the text. Under **Advanced**, named shapes move many rail values at once and add to what you drew: *taper* (one side taller), *grow* (lower lines taller), *pinch* (outer edges pulled in), *ripple* (edges wave against each other), *zigzag* (lines lean alternately) and *bow* (the sides curve).

## MCP for Claude Cowork

Warp & Shear has a remote MCP server with `list_presets` and `render`. The renderer uses the same fonts, presets, and effects as the web editor. `render` returns the design settings and an SVG download link valid for 24 hours.

### Cloudflare Pages

Create a Pages project with **Connect to Git** and select this repository. Set the production branch to `main`, the build command to `npm run build`, and the output directory to `dist`. Pages builds the editor and deploys the Functions for `/mcp`, `/download/…`, and `/health` on the same HTTPS domain. Each push to `main` updates both. [Cloudflare Pages Git integration](https://developers.cloudflare.com/pages/get-started/git-integration/)

In the Pages project settings, add `MCP_DOWNLOAD_SECRET` as a production secret. Generate it with `openssl rand -hex 32` and keep it stable across deployments so outstanding links remain valid. Optionally set `MCP_TOKEN` to a separate value generated the same way. Cloudflare's Workers Free plan limits Functions to 10 ms of CPU per request. Test representative artwork on the live endpoint before relying on the free plan. [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/) · [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

### Connect Claude Cowork

In Claude, go to **Customize → Connectors** and add a custom web connector named **Warp & Shear** with the public URL ending in `/mcp`. Choose **No sign in**. If you set `MCP_TOKEN`, add it as `X-API-Key` under **Request headers**. Claude offers request headers to eligible accounts. With `MCP_TOKEN` unset, anyone who can reach the endpoint can render lettering. [Claude's custom connector guide](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) · [Authentication options](https://claude.com/docs/connectors/building/authentication)

Try asking Cowork to “Use Warp & Shear to render `Make it\n*move*` with the Swoosh preset as a transparent 4:5 SVG, then give me the download link.” Run `npm run test:mcp` to test discovery, rendering, validation, and downloads over HTTP.

### Standalone Node server

On a Node.js 24 host, install with `npm ci --omit=dev` and start with `npm run mcp`. Set the same secrets and set `MCP_PUBLIC_ORIGIN` to the HTTPS origin without a path. The default bind is `127.0.0.1` on port `3000`. A managed container can set `MCP_BIND_HOST` and `PORT` to match its networking requirements. Use `/health` for health checks.

### Add a font

Fonts are baked into static instances by `scripts/build-fonts.sh` (requires [uv](https://docs.astral.sh/uv/)). Each family is baked once per weight (`<Family>-<weight>.ttf`): add it to the loops there and register the family, its weights and its default weight in `FONTS` in `src/state.ts`. Font licenses are in `public/fonts/`.

### Add an effect

Add an `EffectDef` to `EFFECTS` in `src/core/effects.ts` and its parameter type to `EffectsState`. The panel and randomize/mutate actions pick it up automatically.

## License

Font files are distributed under the SIL Open Font License; see the license files in `public/fonts/`. The application code has no license specified yet.

## Made by

**Nando Rossi** · [nan.do](https://nan.do) · [@nandorocker](https://twitter.com/nandorocker)
