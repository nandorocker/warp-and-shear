import type { Font } from 'opentype.js';
import { EFFECTS, effectiveParams, type EffectDef, type EffectsState, type Frame, type PointFn, type Scope } from './effects';
import { emptyBox, growBox, isEmptyBox, type Box, type Pts } from './geom';
import { layoutText, type GlyphItem, type TypeOptions } from './layout';
import { applyCase, parseText, type TextCase } from './text';

export type Aspect = 'fit' | '1:1' | '4:5' | '3:4' | '16:9' | '9:16';

export interface DesignState {
  text: string;
  type: TypeOptions & { font: string; weight: number; textCase: TextCase };
  color: { background: string; text: string; highlight: string };
  effects: EffectsState;
  output: { aspect: Aspect; padding: number; transparent: boolean };
}

export interface Scene {
  glyphs: GlyphItem[];
  /** Ink bounds after all effects. */
  ink: Box;
  /** The block and its line bands as the slice warp sees them (whether or not it is on). */
  slice: SliceLayout | null;
}

/** Block proportions and band boundaries (0 = block top, 1 = block bottom), for the slice widget. */
export interface SliceLayout {
  aspect: number;
  bands: number[];
}

/**
 * Band boundaries for a group of glyphs: the top of the first line, the middle of each gap between
 * lines, the bottom of the last line. Also returns which band each line index falls in. Only lines
 * with ink get a band; a line of spaces joins the nearest inked line's band.
 */
function lineBands(list: GlyphItem[]): { bands: number[]; bandOf: Map<number, number> } {
  const boxes = new Map<number, Box>();
  const inked = new Set<number>();
  for (const g of list) {
    let b = boxes.get(g.line);
    if (!b) boxes.set(g.line, (b = emptyBox()));
    growBox(b, g.frame);
    if (g.contours.length) inked.add(g.line);
  }
  const all = [...boxes.keys()].filter((l) => !isEmptyBox(boxes.get(l)!)).sort((a, b) => a - b);
  const lines = all.some((l) => inked.has(l)) ? all.filter((l) => inked.has(l)) : all;
  const bandOf = new Map<number, number>();
  for (const l of all) {
    let best = 0;
    lines.forEach((m, k) => {
      if (Math.abs(m - l) < Math.abs(lines[best] - l)) best = k;
    });
    bandOf.set(l, best);
  }
  const bx = lines.map((l) => boxes.get(l)!);
  const bands = bx.length ? [bx[0].y0] : [];
  for (let k = 1; k < bx.length; k++) bands.push((bx[k - 1].y1 + bx[k].y0) / 2);
  if (bx.length) bands.push(bx[bx.length - 1].y1);
  // Keep boundaries in order even if earlier effects made lines overlap.
  for (let k = 1; k < bands.length; k++) bands[k] = Math.max(bands[k], bands[k - 1] + 1e-3);
  return { bands, bandOf };
}

function groupKey(g: GlyphItem, idx: number, scope: Scope): number {
  return scope === 'block' ? 0 : scope === 'line' ? g.line : idx;
}

/** Runs one effect over all glyphs, using the current bounds of each scope element as its frame. */
function applyEffect(glyphs: GlyphItem[], scope: Scope, fn: PointFn) {
  const groups = new Map<number, GlyphItem[]>();
  glyphs.forEach((g, idx) => {
    const key = groupKey(g, idx, scope);
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(g);
  });

  // Index elements so stagger / jitter skip blank lines and spaces.
  const inked = [...groups.values()].filter((list) => list.some((g) => g.contours.length > 0));
  const n = Math.max(1, inked.length);
  let i = 0;

  for (const list of groups.values()) {
    const hasInk = list.some((g) => g.contours.length > 0);
    const b = emptyBox();
    for (const g of list) growBox(b, g.frame);
    if (isEmptyBox(b)) continue;
    const w = Math.max(b.x1 - b.x0, 1e-3);
    const h = Math.max(b.y1 - b.y0, 1e-3);
    const { bands, bandOf } = lineBands(list);
    const frame: Frame = { x0: b.x0, y0: b.y0, w, h, cx: b.x0 + w / 2, cy: b.y0 + h / 2, i, n, bands };
    if (hasInk) i++;

    for (const g of list) {
      const band = bandOf.get(g.line) ?? 0;
      const run = (pts: Pts) => {
        for (let j = 0; j < pts.length; j += 2) {
          const [x, y] = fn(pts[j], pts[j + 1], frame, band);
          pts[j] = x;
          pts[j + 1] = y;
        }
      };
      run(g.frame);
      g.contours.forEach(run);
    }
  }
}

export function buildScene(font: Font, s: DesignState): Scene {
  const lines = applyCase(parseText(s.text), s.type.textCase);
  const glyphs = layoutText(font, lines, s.type);
  let slice: SliceLayout | null = null;

  for (const def of EFFECTS) {
    const p = s.effects[def.id as keyof EffectsState];
    if (def.id === 'slice') slice = sliceLayout(glyphs);
    if (!p.enabled) continue;
    // Each def is typed against its own params; the registry lookup is by id.
    const d = def as unknown as EffectDef;
    const fn = d.make(effectiveParams(d, p as unknown as Parameters<EffectDef["make"]>[0]));
    applyEffect(glyphs, p.scope, fn);
  }

  const ink = emptyBox();
  for (const g of glyphs) for (const c of g.contours) growBox(ink, c);
  return { glyphs, ink, slice };
}

function sliceLayout(glyphs: GlyphItem[]): SliceLayout | null {
  const b = emptyBox();
  for (const g of glyphs) growBox(b, g.frame);
  if (isEmptyBox(b)) return null;
  const w = Math.max(b.x1 - b.x0, 1e-3);
  const h = Math.max(b.y1 - b.y0, 1e-3);
  const { bands } = lineBands(glyphs);
  return { aspect: w / h, bands: bands.map((y) => (y - b.y0) / h) };
}

const ASPECTS: Record<Exclude<Aspect, 'fit'>, number> = {
  '1:1': 1,
  '4:5': 4 / 5,
  '3:4': 3 / 4,
  '16:9': 16 / 9,
  '9:16': 9 / 16,
};

export function viewBox(scene: Scene, s: DesignState): [number, number, number, number] {
  const b = isEmptyBox(scene.ink) ? { x0: 0, y0: 0, x1: 100, y1: 100 } : scene.ink;
  let w = b.x1 - b.x0;
  let h = b.y1 - b.y0;
  const pad = s.output.padding * Math.max(w, h);
  let x = b.x0 - pad;
  let y = b.y0 - pad;
  w += pad * 2;
  h += pad * 2;
  if (s.output.aspect !== 'fit') {
    const r = ASPECTS[s.output.aspect];
    if (w / h > r) {
      const nh = w / r;
      y -= (nh - h) / 2;
      h = nh;
    } else {
      const nw = h * r;
      x -= (nw - w) / 2;
      w = nw;
    }
  }
  return [x, y, w, h];
}

function fmt(n: number, dp: number): string {
  const m = 10 ** dp;
  return String(Math.round(n * m) / m);
}

function contourToD(c: Pts, dp: number): string {
  let d = `M${fmt(c[0], dp)} ${fmt(c[1], dp)}L`;
  for (let j = 2; j < c.length; j += 2) d += `${fmt(c[j], dp)} ${fmt(c[j + 1], dp)} `;
  return d.trimEnd() + 'Z';
}

export interface SvgOptions {
  /** Decimal places for coordinates. */
  precision?: number;
  background?: boolean;
}

export function sceneToSvg(scene: Scene, s: DesignState, opts: SvgOptions = {}): string {
  const dp = opts.precision ?? 2;
  const [x, y, w, h] = viewBox(scene, s);
  const vb = [x, y, w, h].map((n) => fmt(n, 2)).join(' ');
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${fmt(w, 0)}" height="${fmt(h, 0)}">`,
  ];
  if (opts.background ?? true) {
    parts.push(`<rect x="${fmt(x, 2)}" y="${fmt(y, 2)}" width="${fmt(w, 2)}" height="${fmt(h, 2)}" fill="${s.color.background}"/>`);
  }
  parts.push(`<g fill="${s.color.text}">`);
  let line = -1;
  for (const g of scene.glyphs) {
    if (g.line !== line) {
      if (line !== -1) parts.push('</g>');
      line = g.line;
      parts.push(`<g id="line-${line + 1}">`);
    }
    if (!g.contours.length) continue;
    const d = g.contours.map((c) => contourToD(c, dp)).join('');
    parts.push(g.hl ? `<path fill="${s.color.highlight}" d="${d}"/>` : `<path d="${d}"/>`);
  }
  if (line !== -1) parts.push('</g>');
  parts.push('</g></svg>');
  return parts.join('');
}
