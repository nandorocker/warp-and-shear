import type { Font, Glyph } from 'opentype.js';
import { flattenPath, sampledRect, type PathCmd, type Pts } from './geom';
import type { Line } from './text';

/** Layout units per em at line scale 1. Everything downstream is relative. */
export const BASE = 100;

export type Align = 'left' | 'center' | 'right';

export interface TypeOptions {
  /** Extra space between letters, in em. */
  tracking: number;
  /**
   * Optical: the closest gap between a line's ink and the ink above it, in
   * base em. Metric: baseline to the next line's cap tops, in em of the
   * incoming line. 0 = touching; negative overlaps.
   */
  leading: number;
  leadingMode: 'optical' | 'metric';
  /** Horizontal scale of the letterforms (fake condensed / extended). */
  stretchX: number;
  align: Align;
  /** 0 = every line at its own size, 1 = every line scaled to the same width. */
  fit: number;
  /** Size multiplier per ^ / ~ step. */
  stepRatio: number;
  /** Max outline segment length in layout units (smaller = smoother, heavier). */
  detail: number;
}

export interface GlyphItem {
  line: number;
  hl: boolean;
  /** Advance box × cap height, sampled. Scopes use its bounds as their frame. */
  frame: Pts;
  contours: Pts[];
}

const outlineCache = new WeakMap<Font, Map<string, Pts[]>>();

/** Glyph outline in em units (y down, origin at baseline), cached. */
function glyphOutlineEm(font: Font, glyph: Glyph, segEm: number): Pts[] {
  let perFont = outlineCache.get(font);
  if (!perFont) outlineCache.set(font, (perFont = new Map()));
  const key = `${glyph.index}:${segEm}`;
  let pts = perFont.get(key);
  if (!pts) {
    const cmds = glyph.getPath(0, 0, 1).commands as unknown as PathCmd[];
    pts = flattenPath(cmds, segEm);
    perFont.set(key, pts);
  }
  return pts;
}

export function capHeightEm(font: Font): number {
  const os2 = font.tables.os2 as { sCapHeight?: number } | undefined;
  return (os2?.sCapHeight || font.ascender * 0.7) / font.unitsPerEm;
}

export function layoutText(font: Font, lines: Line[], o: TypeOptions): GlyphItem[] {
  const upm = font.unitsPerEm;
  const capH = capHeightEm(font);
  const segEm = Math.max(0.2, o.detail) / BASE;

  // Pass 1: glyphs and natural widths (in em, at scale 1).
  const prepared = lines.map((line) => {
    const glyphs = line.chars.map((c) => font.charToGlyph(c.ch));
    const xs: number[] = [];
    const ws: number[] = [];
    let w = 0;
    glyphs.forEach((g, k) => {
      xs.push(w);
      const adv = ((g.advanceWidth ?? 0) / upm) * o.stretchX;
      ws.push(adv);
      w += adv;
      if (k < glyphs.length - 1) {
        w += (font.getKerningValue(g, glyphs[k + 1]) / upm) * o.stretchX + o.tracking;
      }
    });
    return { line, glyphs, xs, ws, widthEm: w, base: Math.pow(o.stepRatio, line.step) };
  });

  // Pass 2: per-line scale. Fit blends geometrically toward equal widths.
  const natural = prepared.map((p) => p.widthEm * p.base);
  const target = Math.max(0, ...natural);
  const scales = prepared.map((p, i) =>
    p.widthEm > 0 && target > 0 ? p.base * Math.pow(target / natural[i], o.fit) : p.base,
  );
  const lineWidths = prepared.map((p, i) => p.widthEm * scales[i] * BASE);
  const blockW = Math.max(0, ...lineWidths);

  // Pass 3: build each line's glyphs with its baseline at y = 0.
  const built = prepared.map((p, li) => {
    const fs = scales[li] * BASE;
    const offset =
      o.align === 'center' ? (blockW - lineWidths[li]) / 2 : o.align === 'right' ? blockW - lineWidths[li] : 0;
    const items: GlyphItem[] = p.glyphs.map((g, k) => {
      const gx = offset + p.xs[k] * fs;
      const contours = glyphOutlineEm(font, g, segEm).map((c) => {
        const out = new Array<number>(c.length);
        for (let j = 0; j < c.length; j += 2) {
          out[j] = gx + c[j] * fs * o.stretchX;
          out[j + 1] = c[j + 1] * fs;
        }
        return out;
      });
      return {
        line: li,
        hl: p.line.chars[k].hl,
        frame: sampledRect(gx, -capH * fs, gx + p.ws[k] * fs, 0),
        contours,
      };
    });
    return { fs, items };
  });

  // Pass 4: stack lines.
  const baselines = o.leadingMode === 'optical' ? opticalBaselines(built, capH, o) : metricBaselines(built, capH, o);

  const out: GlyphItem[] = [];
  built.forEach(({ items }, li) => {
    const b = baselines[li];
    for (const it of items) {
      shiftY(it.frame, b);
      it.contours.forEach((c) => shiftY(c, b));
      out.push(it);
    }
  });
  return out;
}

function shiftY(pts: Pts, dy: number) {
  for (let j = 1; j < pts.length; j += 2) pts[j] += dy;
}

interface BuiltLine {
  fs: number;
  items: GlyphItem[];
}

/** Font-metric stacking: baseline to the next line's cap tops, in em of the incoming line. */
function metricBaselines(lines: BuiltLine[], capH: number, o: TypeOptions): number[] {
  let baseline = 0;
  return lines.map(({ fs }, li) => (baseline += li === 0 ? capH * fs : (capH + o.leading) * fs));
}

/** Share of columns that must clear `leading`; the rest (lone ascenders, dots) may come closer. */
const OPTICAL_BODY = 0.75;
/** Even those may only come this close (as a share of `leading`), so ink never collides. */
const OPTICAL_GUARD = 0.25;

/**
 * Optical stacking, measured column by column across the block against the
 * ink already placed above:
 * - body: most columns (OPTICAL_BODY) sit exactly `leading` (base em) apart, so the
 *   gap people perceive (between the letters' main mass) is the same everywhere;
 * - guard: no column comes closer than OPTICAL_GUARD × leading, so a lone
 *   ascender can tuck in but never collides (unless leading is negative).
 */
function opticalBaselines(lines: BuiltLine[], capH: number, o: TypeOptions): number[] {
  const gap = o.leading * BASE;
  const bw = Math.max(2, o.detail);

  let minX = Infinity;
  let maxX = -Infinity;
  for (const l of lines)
    for (const it of l.items)
      for (const c of it.contours)
        for (let j = 0; j < c.length; j += 2) {
          if (c[j] < minX) minX = c[j];
          if (c[j] > maxX) maxX = c[j];
        }
  if (!(maxX >= minX)) return metricBaselines(lines, capH, o);

  const n = Math.ceil((maxX - minX) / bw) + 1;
  const bucket = (x: number) => Math.min(n - 1, Math.max(0, Math.floor((x - minX) / bw)));
  // Horizontal reach: ink this close sideways also counts as "above".
  const reach = Math.ceil(Math.max(Math.abs(gap), 3) / bw);

  /** Lowest ink placed so far, per column (absolute y; larger = lower). */
  const floor = new Float64Array(n).fill(-Infinity);
  /** Flat floor left by blank lines. */
  let flat = -Infinity;
  let prevBaseline = -Infinity;
  let placedAny = false;

  return lines.map(({ fs, items }) => {
    const top = new Float64Array(n).fill(Infinity);
    const bot = new Float64Array(n).fill(-Infinity);
    let inked = false;
    for (const it of items)
      for (const c of it.contours)
        for (let j = 0; j < c.length; j += 2) {
          const b = bucket(c[j]);
          const y = c[j + 1];
          if (y < top[b]) top[b] = y;
          if (y > bot[b]) bot[b] = y;
          inked = true;
        }

    // Metric position as the fallback (first line, or nothing above to measure against).
    const metric = placedAny ? prevBaseline + (capH + o.leading) * fs : capH * fs;

    if (!inked) {
      // Blank line: lay down a flat floor one cap height (plus gap) below everything so far.
      let lowest = flat;
      for (let b = 0; b < n; b++) if (floor[b] > lowest) lowest = floor[b];
      if (lowest > -Infinity) flat = lowest + capH * fs + gap;
      prevBaseline = placedAny ? metric : prevBaseline;
      return prevBaseline;
    }

    const guardGap = gap >= 0 ? gap * OPTICAL_GUARD : gap;
    const body: number[] = [];
    let guard = -Infinity;
    let minTop = Infinity;
    for (let b = 0; b < n; b++) {
      if (top[b] === Infinity) continue;
      if (top[b] < minTop) minTop = top[b];
      let above = -Infinity;
      for (let k = Math.max(0, b - reach); k <= Math.min(n - 1, b + reach); k++) if (floor[k] > above) above = floor[k];
      if (above === -Infinity) continue;
      body.push(above - top[b] + gap);
      guard = Math.max(guard, above - top[b] + guardGap);
    }
    let baseline = -Infinity;
    if (body.length) {
      body.sort((a, b) => a - b);
      baseline = Math.max(body[Math.floor(OPTICAL_BODY * (body.length - 1))], guard);
    }
    if (flat > -Infinity) baseline = Math.max(baseline, flat - minTop);
    if (baseline === -Infinity) baseline = metric;
    // Never let a line climb above the previous one.
    if (placedAny) baseline = Math.max(baseline, prevBaseline + 1);

    for (let b = 0; b < n; b++) if (bot[b] > -Infinity) floor[b] = Math.max(floor[b], bot[b] + baseline);
    prevBaseline = baseline;
    placedAny = true;
    return baseline;
  });
}
