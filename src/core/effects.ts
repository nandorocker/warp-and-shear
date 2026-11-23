import { DEG, rand, squareToQuad } from './geom';

export type Scope = 'block' | 'line' | 'glyph';

/** The box an effect works in: the current bounds of one block, line or glyph. */
export interface Frame {
  x0: number;
  y0: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  /** Index of this element within its scope (line 0, 1, 2… / glyph 0, 1, 2…). */
  i: number;
  n: number;
}

export type PointFn = (x: number, y: number, f: Frame) => [number, number];

export interface BaseParams {
  enabled: boolean;
  scope: Scope;
  /** Multiplies the effect's strength parameters. 1 = as set, 0 = no effect. */
  amount: number;
}

export interface Control {
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Record<string, string>;
  /** Range Randomize draws from (defaults to min..max). */
  random?: [number, number];
}

export interface EffectDef<P extends BaseParams = BaseParams & Record<string, unknown>> {
  id: string;
  label: string;
  defaults: P;
  controls: { [K in Exclude<keyof P, keyof BaseParams>]?: Control };
  /** Parameters Amount scales (each one must be 0 = neutral). */
  strength: readonly Exclude<keyof P, keyof BaseParams>[];
  /** Parameters shown directly; the rest go under Details. */
  primary: readonly Exclude<keyof P, keyof BaseParams>[];
  make(p: P): PointFn;
}

export const AMOUNT_MAX = 2;

/** Amount is 0..AMOUNT_MAX; anything else (e.g. a hand-edited save) is clamped. */
export function clampAmount(a: number): number {
  return Number.isFinite(a) ? Math.min(AMOUNT_MAX, Math.max(0, a)) : 1;
}

/** Params with Amount applied, clamped to each control's range. */
export function effectiveParams<P extends BaseParams>(def: EffectDef<P>, p: P): P {
  const amount = clampAmount(p.amount);
  if (amount === 1) return p;
  const q = { ...p, amount } as unknown as Record<string, unknown>;
  for (const key of def.strength) {
    const k = key as string;
    const c = (def.controls as Record<string, Control>)[k];
    let v = (p[key] as number) * amount;
    if (c?.min !== undefined) v = Math.max(c.min, v);
    if (c?.max !== undefined) v = Math.min(c.max, v);
    q[k] = v;
  }
  return q as P;
}

/* ------------------------------------------------------------------ */

export interface JitterParams extends BaseParams {
  rotate: number;
  scale: number;
  shiftX: number;
  shiftY: number;
  seed: number;
}

const jitter: EffectDef<JitterParams> = {
  id: 'jitter',
  label: 'Jitter',
  defaults: { enabled: false, scope: 'glyph', amount: 1, rotate: 6, scale: 0.12, shiftX: 0, shiftY: 0.08, seed: 1 },
  controls: {
    rotate: { label: 'rotate °', min: 0, max: 45, step: 0.5, random: [2, 14] },
    scale: { min: 0, max: 0.6, step: 0.01, random: [0, 0.25] },
    shiftX: { label: 'shift x', min: 0, max: 0.5, step: 0.01, random: [0, 0.08] },
    shiftY: { label: 'shift y', min: 0, max: 0.5, step: 0.01, random: [0, 0.15] },
    seed: { min: 1, max: 999, step: 1 },
  },
  strength: ['rotate', 'scale', 'shiftX', 'shiftY'],
  primary: ['rotate', 'scale', 'shiftX', 'shiftY'],
  make: (p) => (x, y, f) => {
    const r = (rand(p.seed, f.i, 1) * 2 - 1) * p.rotate * DEG;
    const s = 1 + (rand(p.seed, f.i, 2) * 2 - 1) * p.scale;
    const dx = (rand(p.seed, f.i, 3) * 2 - 1) * p.shiftX * f.w;
    const dy = (rand(p.seed, f.i, 4) * 2 - 1) * p.shiftY * f.h;
    const ux = (x - f.cx) * s;
    const uy = (y - f.cy) * s;
    const c = Math.cos(r);
    const sn = Math.sin(r);
    return [f.cx + ux * c - uy * sn + dx, f.cy + ux * sn + uy * c + dy];
  },
};

/* ------------------------------------------------------------------ */

export interface ShearParams extends BaseParams {
  skewX: number;
  skewY: number;
  rotate: number;
}

const shear: EffectDef<ShearParams> = {
  id: 'shear',
  label: 'Shear',
  defaults: { enabled: true, scope: 'block', amount: 1, skewX: 0, skewY: 0, rotate: 0 },
  controls: {
    skewX: { label: 'lean °', min: -45, max: 45, step: 0.5, random: [-6, 20] },
    skewY: { label: 'rise °', min: -45, max: 45, step: 0.5, random: [-18, 18] },
    rotate: { label: 'rotate °', min: -90, max: 90, step: 0.5, random: [-8, 8] },
  },
  strength: ['skewX', 'skewY', 'rotate'],
  primary: ['skewX', 'skewY', 'rotate'],
  make: (p) => {
    const tx = Math.tan(p.skewX * DEG);
    const ty = Math.tan(p.skewY * DEG);
    const c = Math.cos(p.rotate * DEG);
    const s = Math.sin(p.rotate * DEG);
    return (x, y, f) => {
      const dx = x - f.cx;
      const dy = y - f.cy;
      // Lean: tops move right. Rise: right side moves up. Stems stay vertical under rise.
      const sx = dx - tx * dy;
      const sy = dy - ty * dx;
      // Rotate counter-clockwise on screen (y points down).
      return [f.cx + sx * c + sy * s, f.cy - sx * s + sy * c];
    };
  },
};

/* ------------------------------------------------------------------ */

export type EnvelopeStyle = 'flag' | 'arc' | 'bulge' | 'swell' | 'rise';

export interface EnvelopeParams extends BaseParams {
  style: EnvelopeStyle;
  bend: number;
  waves: number;
  phase: number;
  stagger: number;
  hPersp: number;
  vPersp: number;
}

const envelope: EffectDef<EnvelopeParams> = {
  id: 'envelope',
  label: 'Envelope warp',
  defaults: {
    enabled: false,
    scope: 'block',
    amount: 1,
    style: 'flag',
    bend: 0.4,
    waves: 1,
    phase: 0,
    stagger: 0,
    hPersp: 0,
    vPersp: 0,
  },
  controls: {
    style: { options: { Flag: 'flag', Arc: 'arc', Bulge: 'bulge', Swell: 'swell', Rise: 'rise' } },
    bend: { min: -1.5, max: 1.5, step: 0.01, random: [-0.8, 0.8] },
    waves: { min: 0.1, max: 4, step: 0.05, random: [0.4, 1.6] },
    phase: { label: 'phase °', min: -180, max: 180, step: 1 },
    stagger: { label: 'stagger °', min: -180, max: 180, step: 1, random: [-60, 60] },
    hPersp: { label: 'h persp', min: -0.95, max: 0.95, step: 0.01, random: [-0.5, 0.5] },
    vPersp: { label: 'v persp', min: -0.95, max: 0.95, step: 0.01, random: [-0.3, 0.3] },
  },
  strength: ['bend', 'hPersp', 'vPersp'],
  primary: ['waves'],
  make: (p) => {
    const b = p.bend * 0.6;
    const k = 2 * Math.PI * p.waves;
    const ph0 = p.phase * DEG;
    const st = p.stagger * DEG;
    return (x, y, f) => {
      const u = (x - f.x0) / f.w;
      const v = (y - f.y0) / f.h;
      const arc = 1 - (2 * u - 1) * (2 * u - 1);
      const s = Math.sin(k * u + ph0 + st * f.i);
      // Top and bottom edge offsets, in units of frame height.
      let top = 0;
      let bot = 0;
      switch (p.style) {
        case 'flag':
          top = bot = -b * s;
          break;
        case 'arc':
          top = bot = -b * arc;
          break;
        case 'bulge':
          top = -b * arc * 0.5;
          bot = b * arc * 0.5;
          break;
        case 'swell':
          top = -b * s * 0.5;
          bot = b * s * 0.5;
          break;
        case 'rise':
          top = bot = -b * (2 * u - 1);
          break;
      }
      const yn = top + v * (1 + bot - top);
      // Perspective: left/right edges (h) and top/bottom edges (v) get different lengths.
      const hw = f.w / 2;
      const hh = f.h / 2;
      const hp = p.hPersp;
      const vp = p.vPersp;
      const map = squareToQuad([
        [f.cx - hw * (1 + vp), f.cy - hh * (1 + hp)],
        [f.cx + hw * (1 + vp), f.cy - hh * (1 - hp)],
        [f.cx + hw * (1 - vp), f.cy + hh * (1 - hp)],
        [f.cx - hw * (1 - vp), f.cy + hh * (1 + hp)],
      ]);
      return map(u, yn);
    };
  },
};

/* ------------------------------------------------------------------ */

export interface ClothParams extends BaseParams {
  depth: number;
  waves: number;
  phase: number;
  stagger: number;
  diagonal: number;
  pole: number;
  turn: number;
  tilt: number;
  perspective: number;
}

/**
 * The surface is a real 3D ripple (depth = sin along the text), turned and
 * tilted, then projected with perspective. Height and spacing changes fall
 * out of the projection, which is what makes it read as cloth, not wavy text.
 */
const cloth: EffectDef<ClothParams> = {
  id: 'cloth',
  label: 'Cloth 3D',
  defaults: {
    enabled: false,
    scope: 'block',
    amount: 1,
    depth: 0.5,
    waves: 1,
    phase: 90,
    stagger: 0,
    diagonal: 0,
    pole: 0,
    turn: 25,
    tilt: 0,
    perspective: 0.6,
  },
  controls: {
    depth: { min: 0, max: 1.5, step: 0.01, random: [0.2, 0.9] },
    waves: { min: 0.1, max: 4, step: 0.05, random: [0.4, 1.8] },
    phase: { label: 'phase °', min: -180, max: 180, step: 1 },
    stagger: { label: 'stagger °', min: -180, max: 180, step: 1, random: [-45, 45] },
    diagonal: { min: -2, max: 2, step: 0.01, random: [-0.8, 0.8] },
    pole: { min: 0, max: 1, step: 0.01, random: [0, 0.8] },
    turn: { label: 'turn °', min: -75, max: 75, step: 0.5, random: [-45, 45] },
    tilt: { label: 'tilt °', min: -60, max: 60, step: 0.5, random: [-25, 25] },
    perspective: { min: 0, max: 1, step: 0.01, random: [0.2, 0.9] },
  },
  strength: ['depth', 'turn', 'tilt'],
  primary: ['waves'],
  make: (p) => {
    const k = 2 * Math.PI * p.waves;
    const ph0 = p.phase * DEG;
    const st = p.stagger * DEG;
    const cy = Math.cos(p.turn * DEG);
    const sy = Math.sin(p.turn * DEG);
    const ct = Math.cos(p.tilt * DEG);
    const stl = Math.sin(p.tilt * DEG);
    return (x, y, f) => {
      const u = (x - f.x0) / f.w;
      const v = (y - f.y0) / f.h;
      const X = (u - 0.5) * f.w;
      const Y = (v - 0.5) * f.h;
      const amp = p.depth * 0.25 * f.w * (1 - p.pole + p.pole * u);
      const Z = amp * Math.sin(k * u + ph0 + st * f.i + p.diagonal * Math.PI * v);
      // Turn around the vertical axis (positive: right side recedes).
      const X1 = X * cy - Z * sy;
      const Z1 = X * sy + Z * cy;
      // Tilt around the horizontal axis (positive: top recedes).
      const Y2 = Y * ct + Z1 * stl;
      const Z2 = -Y * stl + Z1 * ct;
      let s = 1;
      if (p.perspective > 0.001) {
        const F = (Math.max(f.w, f.h) * 0.9) / p.perspective;
        s = F / Math.max(F + Z2, F * 0.05);
      }
      return [f.cx + X1 * s, f.cy + Y2 * s];
    };
  },
};

/** Fixed pipeline order: per-glyph chaos → shear → 2D envelope → 3D cloth. */
export { cloth, envelope, jitter, shear };
export const EFFECTS = [jitter, shear, envelope, cloth] as const;

export interface EffectsState {
  jitter: JitterParams;
  shear: ShearParams;
  envelope: EnvelopeParams;
  cloth: ClothParams;
}

export type EffectId = keyof EffectsState;
