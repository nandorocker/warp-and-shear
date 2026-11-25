import {
  RAIL_PINS,
  SLICE_SHAPES,
  effectiveParams,
  railAt,
  railKey,
  railPoints,
  slice,
  sliceRails,
  type Frame,
  type Rail,
  type SliceParams,
} from '../core/effects';
import type { SliceLayout } from '../core/render';
import { BOX, clamp, onDrag, svgEl } from './mesh';

const PAD = 46;
const LIMIT = 1;
const f2 = (n: number) => (Math.round(n * 10) / 10).toString();

/** Two equal lines, for when there is no text to measure yet. */
const FALLBACK: SliceLayout = { aspect: 2.2, bands: [0, 0.5, 1] };

/** Handle size in view units (the stage is about 1.15 CSS px per unit at the usual panel width). */
const HANDLE = 6.5;

type Part = 'l' | 'r' | 'line' | (typeof RAIL_PINS)[number];

/** The elements for one rail, kept across renders so hover and the grabbed state survive a drag. */
interface RailEls {
  hit: SVGPathElement;
  vis: SVGPathElement;
  ends: [SVGRectElement, SVGRectElement];
  pins: SVGCircleElement[];
}

/**
 * Slice widget: the block cut into one band per line, with a rail at every band boundary.
 * Drag a rail's square ends to tilt it or lean the sides, the round pins between them to bend it,
 * or the rail itself to move the whole boundary. Double-click any of them to reset it.
 */
export function sliceWidget(p: SliceParams, layout: () => SliceLayout | null, onEdit: () => void) {
  const el = document.createElement('div');
  el.className = 'wdg';

  const stage = svgEl('svg', { class: 'wdg-stage wdg-slice' });
  const grid = svgEl('path', { class: 'wdg-grid' });
  const outline = svgEl('path', { class: 'wdg-outline' });
  const railsG = svgEl('g');
  const handlesG = svgEl('g');
  stage.append(grid, outline, railsG, handlesG);

  const hint = document.createElement('div');
  hint.className = 'wdg-hint';
  hint.textContent = 'Drag handles and rails to tilt and lean. Double-click them to reset.';

  const actions = document.createElement('div');
  actions.className = 'wdg-chips';
  const flatten = document.createElement('button');
  flatten.type = 'button';
  flatten.textContent = 'Flatten all';
  flatten.addEventListener('click', () => {
    for (const r of Object.values(p.rails)) reset(r, 'line');
    for (const k of SLICE_SHAPES) p[k] = 0;
    onEdit();
  });
  actions.append(flatten);

  el.append(stage, hint, actions);

  /* Current geometry, rebuilt on every render. */
  let f: Frame = { x0: 0, y0: 0, w: BOX.w, h: BOX.h, cx: BOX.w / 2, cy: BOX.h / 2, i: 0, n: 1 };
  let viewW = BOX.w + PAD * 2;

  /** The stored rail at boundary k; undefined past the last stored middle rail (those stay flat). */
  const railOf = (k: number): Rail | undefined => p.rails[railKey(k, f.bands!.length - 1)];

  const reset = (rail: Rail, part: Part) => {
    if (part === 'l' || part === 'r') {
      rail[`${part}x`] = 0;
      rail[`${part}y`] = 0;
    } else if (part === 'line') {
      Object.assign(rail, { lx: 0, ly: 0, rx: 0, ry: 0, p1: 0, p2: 0, p3: 0 });
    } else {
      rail[part] = 0;
    }
  };

  const isFlat = () =>
    SLICE_SHAPES.every((k) => Math.abs(p[k]) < 1e-9) &&
    Object.values(p.rails).every((r) => Object.values(r).every((v) => Math.abs(v) < 1e-9));

  // Double-click is detected here: pointer capture would retarget a native dblclick to the stage.
  let lastPress = { key: '', at: 0 };
  let grabbed: Element | null = null;
  const railEls: RailEls[] = [];

  /** Elements for rails 0..count-1, created on demand; extra ones are hidden, not removed. */
  function ensureRails(count: number) {
    while (railEls.length < count) {
      const k = railEls.length;
      const hit = svgEl('path', { class: 'wdg-rail-hit', 'data-rail': k, 'data-part': 'line' });
      const vis = svgEl('path', { class: 'wdg-rail' });
      const end = (part: 'l' | 'r') =>
        svgEl('rect', { width: HANDLE * 2, height: HANDLE * 2, rx: 2, class: 'wdg-handle', 'data-rail': k, 'data-part': part });
      const ends: [SVGRectElement, SVGRectElement] = [end('l'), end('r')];
      const pins = RAIL_PINS.map((part) => svgEl('circle', { r: HANDLE, class: 'wdg-handle pin', 'data-rail': k, 'data-part': part }));
      railsG.append(hit, vis);
      handlesG.append(ends[0], ...pins, ends[1]);
      railEls.push({ hit, vis, ends, pins });
    }
  }

  onDrag(stage, (e) => {
    if (!p.enabled || p.amount < 0.01) return null;
    const t = e.target as Element;
    const kAttr = t.getAttribute('data-rail');
    if (kAttr === null) return null;
    const rail = railOf(Number(kAttr));
    if (!rail) return null;
    const part = t.getAttribute('data-part') as Part;
    const key = `${kAttr}:${part}`;
    if (lastPress.key === key && e.timeStamp - lastPress.at < 350) {
      lastPress = { key: '', at: 0 };
      reset(rail, part);
      onEdit();
      return null;
    }
    lastPress = { key, at: e.timeStamp };
    t.classList.add('active');
    grabbed = t;
    const start = { ...rail };
    const amt = p.amount;
    // Pointer pixels → block-relative offsets (the stage is scaled uniformly to its width).
    return ({ dx, dy, width, event }) => {
      const k = viewW / width;
      const fine = event.shiftKey ? 0.25 : 1;
      const ox = (dx * k * fine) / f.w / amt;
      const oy = (dy * k * fine) / f.h / amt;
      if (part === 'l' || part === 'r') {
        rail[`${part}x`] = clamp(start[`${part}x`] + ox, -LIMIT, LIMIT);
        rail[`${part}y`] = clamp(start[`${part}y`] + oy, -LIMIT, LIMIT);
      } else if (part === 'line') {
        rail.ly = clamp(start.ly + oy, -LIMIT, LIMIT);
        rail.ry = clamp(start.ry + oy, -LIMIT, LIMIT);
      } else {
        rail[part] = clamp(start[part] + oy, -LIMIT, LIMIT);
      }
      onEdit();
    };
  }, () => {
    grabbed?.classList.remove('active');
    grabbed = null;
  });

  function render() {
    el.classList.toggle('off', !p.enabled);
    const lay = layout() ?? FALLBACK;
    // Fit the block to the stage width; very tall or very wide blocks are squashed to stay usable.
    const w = BOX.w;
    const h = clamp(w / lay.aspect, 70, 220);
    const bands = lay.bands.length >= 2 ? lay.bands.map((b) => b * h) : [0, h];
    f = { x0: 0, y0: 0, w, h, cx: w / 2, cy: h / 2, i: 0, n: 1, bands };
    viewW = w + PAD * 2;
    const viewH = h + PAD * 2;
    stage.setAttribute('viewBox', `${-PAD} ${-PAD} ${viewW} ${viewH}`);
    stage.style.aspectRatio = `${viewW} / ${viewH}`;

    const ep = effectiveParams(slice, p);
    const fn = slice.make(ep);
    const nb = bands.length - 1;
    const rails = sliceRails(ep, nb);
    const curves = bands.map((y, k) => railPoints(rails[k], y, f));

    // Grid: verticals through every band (straight within a band, kinked at rails), plus each band's middle.
    const COLS = 10;
    let g = '';
    for (let c = 1; c < COLS; c++) {
      const x = (c / COLS) * w;
      for (let b = 0; b < nb; b++) {
        const [ax, ay] = fn(x, bands[b], f, b);
        const [bx, by] = fn(x, bands[b + 1], f, b);
        g += `${b ? 'L' : 'M'}${f2(ax)} ${f2(ay)}L${f2(bx)} ${f2(by)}`;
      }
    }
    for (let b = 0; b < nb; b++) {
      const ym = (bands[b] + bands[b + 1]) / 2;
      for (let j = 0; j <= 40; j++) {
        const [x, y] = fn((j / 40) * w, ym, f, b);
        g += `${j ? 'L' : 'M'}${f2(x)} ${f2(y)}`;
      }
    }
    grid.setAttribute('d', g);

    const curve = (P: [number, number][], rev = false) => {
      let d = '';
      for (let j = 0; j <= 48; j++) {
        const [x, y] = railAt(P, rev ? 1 - j / 48 : j / 48);
        d += `${j ? 'L' : 'M'}${f2(x)} ${f2(y)}`;
      }
      return d;
    };
    // Outline: top rail, right side down each band, bottom rail back, left side up.
    let o = curve(curves[0]);
    for (let k = 1; k <= nb; k++) o += `L${f2(curves[k][4][0])} ${f2(curves[k][4][1])}`;
    o += curve(curves[nb], true).replace(/^M/, 'L');
    for (let k = nb - 1; k >= 0; k--) o += `L${f2(curves[k][0][0])} ${f2(curves[k][0][1])}`;
    outline.setAttribute('d', o + 'Z');

    ensureRails(curves.length);
    railEls.forEach((els, k) => {
      const shown = k < curves.length;
      // Past the last stored middle rail (9+ lines) a rail stays flat: draw it, but offer no handles.
      const editable = shown && railOf(k) !== undefined;
      els.vis.toggleAttribute('hidden', !shown);
      for (const e of [els.hit, ...els.ends, ...els.pins]) e.toggleAttribute('hidden', !editable);
      if (!shown) return;
      const P = curves[k];
      const d = curve(P);
      els.vis.setAttribute('d', d);
      els.vis.classList.toggle('edge', k === 0 || k === nb);
      els.hit.setAttribute('d', d);
      els.ends.forEach((r, j) => {
        const [x, y] = P[j ? 4 : 0];
        r.setAttribute('x', f2(x - HANDLE));
        r.setAttribute('y', f2(y - HANDLE));
      });
      els.pins.forEach((c, j) => {
        c.setAttribute('cx', f2(P[j + 1][0]));
        c.setAttribute('cy', f2(P[j + 1][1]));
      });
    });
    flatten.disabled = isFlat();
  }

  return { el, render };
}
