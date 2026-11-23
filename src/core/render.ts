import type { Font } from 'opentype.js';
import { EFFECTS, effectiveParams, type EffectDef, type EffectsState, type Frame, type Scope } from './effects';
import { emptyBox, growBox, isEmptyBox, type Box, type Pts } from './geom';
import { layoutText, type GlyphItem, type TypeOptions } from './layout';
import { applyCase, parseText, type TextCase } from './text';

export type Aspect = 'fit' | '1:1' | '4:5' | '3:4' | '16:9' | '9:16';

export interface DesignState {
  text: string;
  type: TypeOptions & { font: string; textCase: TextCase };
  color: { background: string; text: string; highlight: string };
  effects: EffectsState;
  output: { aspect: Aspect; padding: number; transparent: boolean };
}

export interface Scene {
  glyphs: GlyphItem[];
  /** Ink bounds after all effects. */
  ink: Box;
}

function groupKey(g: GlyphItem, idx: number, scope: Scope): number {
  return scope === 'block' ? 0 : scope === 'line' ? g.line : idx;
}

/** Runs one effect over all glyphs, using the current bounds of each scope element as its frame. */
function applyEffect(glyphs: GlyphItem[], scope: Scope, fn: (x: number, y: number, f: Frame) => [number, number]) {
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
    const frame: Frame = { x0: b.x0, y0: b.y0, w, h, cx: b.x0 + w / 2, cy: b.y0 + h / 2, i, n };
    if (hasInk) i++;

    const run = (pts: Pts) => {
      for (let j = 0; j < pts.length; j += 2) {
        const [x, y] = fn(pts[j], pts[j + 1], frame);
        pts[j] = x;
        pts[j + 1] = y;
      }
    };
    for (const g of list) {
      run(g.frame);
      g.contours.forEach(run);
    }
  }
}

export function buildScene(font: Font, s: DesignState): Scene {
  const lines = applyCase(parseText(s.text), s.type.textCase);
  const glyphs = layoutText(font, lines, s.type);

  for (const def of EFFECTS) {
    const p = s.effects[def.id as keyof EffectsState];
    if (!p.enabled) continue;
    // Each def is typed against its own params; the registry lookup is by id.
    const d = def as unknown as EffectDef;
    const fn = d.make(effectiveParams(d, p as unknown as Parameters<EffectDef["make"]>[0]));
    applyEffect(glyphs, p.scope, fn);
  }

  const ink = emptyBox();
  for (const g of glyphs) for (const c of g.contours) growBox(ink, c);
  return { glyphs, ink };
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
