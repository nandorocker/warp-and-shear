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
   * Gap between a line's baseline and the next line's cap tops, in em of the
   * incoming line. 0 = caps touch the line above; negative overlaps.
   */
  leading: number;
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

  // Pass 3: place glyphs.
  const items: GlyphItem[] = [];
  let baseline = 0;
  prepared.forEach((p, li) => {
    const fs = scales[li] * BASE;
    baseline += li === 0 ? capH * fs : (capH + o.leading) * fs;
    const offset =
      o.align === 'center' ? (blockW - lineWidths[li]) / 2 : o.align === 'right' ? blockW - lineWidths[li] : 0;

    p.glyphs.forEach((g, k) => {
      const gx = offset + p.xs[k] * fs;
      const contours = glyphOutlineEm(font, g, segEm).map((c) => {
        const out = new Array<number>(c.length);
        for (let j = 0; j < c.length; j += 2) {
          out[j] = gx + c[j] * fs * o.stretchX;
          out[j + 1] = baseline + c[j + 1] * fs;
        }
        return out;
      });
      items.push({
        line: li,
        hl: p.line.chars[k].hl,
        frame: sampledRect(gx, baseline - capH * fs, gx + p.ws[k] * fs, baseline),
        contours,
      });
    });
  });
  return items;
}
