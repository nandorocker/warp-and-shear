import { effectiveParams, envelope, type EnvelopeParams, type EnvelopeStyle } from '../core/effects';
import { BOX, clamp, frameFor, onDrag, svgEl, warpedMesh, wrapDeg } from './mesh';

const STYLES: { id: EnvelopeStyle; label: string }[] = [
  { id: 'flag', label: 'Flag' },
  { id: 'arc', label: 'Arc' },
  { id: 'bulge', label: 'Bulge' },
  { id: 'swell', label: 'Swell' },
  { id: 'rise', label: 'Rise' },
];

const WAVY = new Set<EnvelopeStyle>(['flag', 'swell']);
const CORNERS: [number, number][] = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1],
];
const VIEW = { x: -60, y: -55, w: 360, h: 220 };

/** Shape value at u: which way a point at u moves for positive bend. */
function shapeAt(p: EnvelopeParams, u: number): number {
  switch (p.style) {
    case 'flag':
    case 'swell':
      return Math.sin(2 * Math.PI * p.waves * u + (p.phase * Math.PI) / 180);
    case 'arc':
    case 'bulge':
      return 1 - (2 * u - 1) ** 2;
    case 'rise':
      return 2 * u - 1;
  }
}

/**
 * Envelope widget: a live warp mesh. Drag the mesh to bend (and slide the wave
 * for Flag/Swell); drag a corner for perspective. Style tiles below.
 */
export function envelopeWidget(p: EnvelopeParams, onEdit: () => void) {
  const el = document.createElement('div');
  el.className = 'wdg';

  const stage = svgEl('svg', { viewBox: `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`, class: 'wdg-stage' });
  const grid = svgEl('path', { class: 'wdg-grid' });
  const outline = svgEl('path', { class: 'wdg-outline' });
  const handles = CORNERS.map((_, i) => svgEl('circle', { r: 7, class: 'wdg-handle', 'data-corner': i }));
  stage.append(grid, outline, ...handles);

  const hint = document.createElement('div');
  hint.className = 'wdg-hint';

  const tiles = document.createElement('div');
  tiles.className = 'wdg-tiles';
  const tileEls = STYLES.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wdg-tile';
    b.title = s.label;
    const svg = svgEl('svg', { viewBox: `-30 -45 300 200` });
    const g = svgEl('path', { class: 'wdg-grid' });
    const o = svgEl('path', { class: 'wdg-outline' });
    svg.append(g, o);
    const label = document.createElement('span');
    label.textContent = s.label;
    b.append(svg, label);
    b.addEventListener('click', () => {
      p.style = s.id;
      onEdit();
    });
    tiles.append(b);
    return { b, g, o, id: s.id };
  });

  el.append(stage, hint, tiles);

  const f = frameFor();
  const toView = (px: number, width: number) => (px * VIEW.w) / width;

  onDrag(stage, (e) => {
    if (!p.enabled) return null;
    // At Amount 0 the strength params have no visible effect, so don't edit them blind.
    const live = p.amount > 0.01;
    const amt = Math.max(p.amount, 0.2);
    const corner = (e.target as Element).getAttribute('data-corner');
    if (corner !== null) {
      if (!live) return null;
      const [u, v] = CORNERS[Number(corner)];
      const sx = u === 0 ? -1 : 1;
      const sy = v === 0 ? -1 : 1;
      const hp0 = p.hPersp;
      const vp0 = p.vPersp;
      return ({ dx, dy, width }) => {
        const vx = toView(dx, width);
        const vy = toView(dy, width);
        p.hPersp = clamp(hp0 + ((vy * sy) / (BOX.h / 2)) * (sx < 0 ? 1 : -1) / amt, -0.95, 0.95);
        p.vPersp = clamp(vp0 + ((vx * sx) / (BOX.w / 2)) * (sy < 0 ? 1 : -1) / amt, -0.95, 0.95);
        onEdit();
      };
    }
    // Grab: the grabbed part follows the cursor vertically; the wave slides sideways.
    const rect = stage.getBoundingClientRect();
    const u = ((e.clientX - rect.left) * VIEW.w) / rect.width + VIEW.x;
    const v = ((e.clientY - rect.top) * VIEW.w) / rect.width + VIEW.y;
    const g = shapeAt(p, clamp(u / BOX.w, 0, 1));
    // Bulge/Swell move top and bottom edges in opposite directions: displacement
    // is proportional to (0.5 - v), so the grabbed half decides the sign.
    const split = p.style === 'bulge' || p.style === 'swell';
    const wv = split ? 2 * (0.5 - clamp(v / BOX.h, 0, 1)) : 1;
    const gw = g * wv;
    const sign = Math.abs(gw) < 0.15 ? (wv < 0 ? -1 : 1) : Math.sign(gw);
    const gain = split ? 2 / Math.max(Math.abs(wv), 0.4) : 1;
    const b0 = p.bend;
    const ph0 = p.phase;
    return ({ dx, dy, width }) => {
      if (live) p.bend = clamp(b0 - (sign * gain * toView(dy, width)) / (0.6 * BOX.h) / amt, -1.5, 1.5);
      if (WAVY.has(p.style)) p.phase = Math.round(wrapDeg(ph0 - (360 * p.waves * toView(dx, width)) / BOX.w));
      onEdit();
    };
  });

  function render() {
    el.classList.toggle('off', !p.enabled);
    const fn = envelope.make(effectiveParams(envelope, p));
    const m = warpedMesh(fn, f);
    grid.setAttribute('d', m.grid);
    outline.setAttribute('d', m.outline);
    CORNERS.forEach(([u, v], i) => {
      const [x, y] = fn(u * f.w, v * f.h, f);
      handles[i].setAttribute('cx', String(x));
      handles[i].setAttribute('cy', String(y));
    });
    hint.textContent = WAVY.has(p.style)
      ? 'Drag the mesh: up/down bends, sideways slides the wave. Corners: perspective.'
      : 'Drag the mesh up/down to bend. Corners: perspective.';
    for (const t of tileEls) {
      t.b.classList.toggle('active', t.id === p.style);
      const tfn = envelope.make({ ...p, amount: 1, style: t.id, bend: 0.55, phase: 0, stagger: 0, hPersp: 0, vPersp: 0 });
      const tm = warpedMesh(tfn, f, 6, 3, 24);
      t.g.setAttribute('d', tm.grid);
      t.o.setAttribute('d', tm.outline);
    }
  }

  return { el, render };
}
