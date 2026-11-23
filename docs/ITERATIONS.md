# Iteration plan

Principle: effects are shapes you manipulate; numbers are the readout. Every
number stays reachable in an effect's **Details** section and updates live while
you drag, the way Figma's X/Y/W/H fields work.

## 1. Envelope and Cloth as visual controls (current)

- **Amount per effect** (0–200%). Scales the effect's strength parameters together,
  so each effect is "a shape plus how much". 0% is no effect. Details keep the shape.
- **Envelope widget:** a live warp mesh drawn by the real effect function.
  - Drag on the mesh: up/down = bend, sideways = slide the wave (phase).
  - Drag a corner handle: perspective (taller/shorter side, wider/narrower edge).
  - Style tiles (Flag, Arc, Bulge, Swell, Rise) drawn as tiny meshes.
- **Cloth widget:** a live 3D mesh.
  - Drag the mesh to orbit it (turn / tilt). Double-click resets the orbit.
  - A wave strip below: up/down = depth, sideways = slide the wave.
  - Lens chips (Flat / Normal / Wide / Ultra) instead of a perspective number.
- Secondary settings (stagger, diagonal, pole, raw angles) move into a collapsed **Details** section.

Done when you can get the Sabbath and Make-it-work looks without opening Details.

## 2. Exploration

- **Variations grid** replaces Randomize: 6–9 live thumbnails of your text. Click one to
  adopt it, then generate the next round from it.
- **Preset thumbnails** that preview on hover, instead of the dropdown.

## 3. On the canvas

- Bounding-box handles on the artwork: drag the top edge to lean, the side edge to rise,
  and the corners for perspective. A tooltip shows the value while dragging.
- Envelope top/bottom edges as editable curves on the artwork (adds a Custom style).
- A per-line size handle at the end of each line, replacing `^` / `~` for most uses.

## 4. Type panel polish

- Segmented icon buttons for case (`Aa AA aa`), align (plus Justify instead of the
  fit-width slider), and scope (block / line / glyph pictograms).
- Scrubby number fields: drag the label to change tracking or leading.
- Highlight by selecting text and clicking a swatch; the markup stays as a fallback.
