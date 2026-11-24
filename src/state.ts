import { EFFECTS, clampAmount, type Control, type EffectsState } from './core/effects';
import type { DesignState } from './core/render';

/** Families and the weights baked for each (see scripts/build-fonts.sh). `defaultWeight` is what the family used
 *  before weights were selectable, so older settings and presets without a weight keep their look. */
export const FONTS = {
  dmsans: { label: 'DM Sans', file: 'DMSans', weights: [400, 500, 600, 700, 800, 900, 1000], defaultWeight: 1000 },
  outfit: { label: 'Outfit', file: 'Outfit', weights: [400, 500, 600, 700, 800, 900], defaultWeight: 600 },
  archivo: { label: 'Archivo Condensed', file: 'ArchivoCondensed', weights: [400, 500, 600, 700, 800, 900], defaultWeight: 900 },
} as const satisfies Record<string, { label: string; file: string; weights: readonly number[]; defaultWeight: number }>;

export type FontId = keyof typeof FONTS;

export const WEIGHT_NAMES: Record<number, string> = {
  400: 'Regular',
  500: 'Medium',
  600: 'SemiBold',
  700: 'Bold',
  800: 'ExtraBold',
  900: 'Black',
  1000: 'Extra Black',
};

export function fontFile(id: FontId, weight: number): string {
  return `fonts/${FONTS[id].file}-${weight}.ttf`;
}

/** The closest weight the family actually has (ties go heavier, since this is display type). */
export function nearestWeight(id: FontId, weight: number): number {
  const ws = FONTS[id].weights as readonly number[];
  return ws.reduce((best, w) => (Math.abs(w - weight) <= Math.abs(best - weight) ? w : best), ws[0]);
}

function defaultEffects(): EffectsState {
  return Object.fromEntries(EFFECTS.map((d) => [d.id, structuredClone(d.defaults)])) as unknown as EffectsState;
}

export function defaultState(): DesignState {
  return {
    text: 'All eyes\non *you.*',
    type: {
      font: 'dmsans',
      weight: 1000,
      textCase: 'as-typed',
      tracking: -0.03,
      leading: 0.06,
      leadingMode: 'optical',
      stretchX: 1,
      align: 'left',
      fit: 0,
      stepRatio: 1.4,
      detail: 1.5,
    },
    color: { background: '#f4f1ec', text: '#111111', highlight: '#f26522' },
    effects: defaultEffects(),
    output: { aspect: 'fit', padding: 0.08, transparent: false },
  };
}

/* ---------------- presets ---------------- */

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const PRESETS: Record<string, DeepPartial<DesignState>> = {
  'Waving flag': {
    text: 'The human\n^edge.',
    type: { font: 'archivo', textCase: 'upper', tracking: -0.01, leading: 0.1, fit: 0.5 },
    effects: {
      shear: { enabled: true, skewX: 9 },
      envelope: { enabled: true, style: 'flag', bend: 0.35, waves: 0.6, phase: -30, hPersp: 0.35 },
    },
  },
  'Rippling lines': {
    text: 'Make it up.\nMake it\n^^work.',
    type: { font: 'dmsans', textCase: 'upper', tracking: -0.02, leading: 0.2 },
    color: { background: '#c9c3f5', text: '#1b1d33' },
    effects: {
      shear: { enabled: true, skewX: 8 },
      cloth: { enabled: true, scope: 'line', depth: 0.5, waves: 0.6, phase: 60, stagger: 40, turn: 20, tilt: 10, perspective: 0.6 },
    },
  },
  'Billowing sheet': {
    text: 'The human\n^edge.',
    type: { font: 'archivo', textCase: 'upper', tracking: -0.01, leading: 0.1, fit: 0.5 },
    effects: {
      shear: { enabled: true, skewX: 9 },
      cloth: { enabled: true, depth: 0.9, waves: 0.75, phase: 40, turn: 12, tilt: 25, perspective: 0.8 },
    },
  },
  'Side turn': {
    text: 'All\neyes\non *you.*',
    type: { font: 'archivo', textCase: 'upper', tracking: -0.01, leading: 0.04, stretchX: 0.9 },
    effects: {
      shear: { enabled: true, skewX: -4, skewY: 6 },
      cloth: { enabled: true, depth: 0.45, waves: 0.8, phase: 120, turn: -28, tilt: 0, perspective: 0.6 },
    },
  },
  'Italic climb': {
    text: 'Human\nedge.',
    type: { font: 'dmsans', textCase: 'sentence', tracking: -0.04, leading: 0.1 },
    color: { background: '#d4deee', text: '#111111' },
    effects: { shear: { enabled: true, skewX: 12, skewY: 14 } },
  },
  Uphill: {
    text: 'Make it up.\nMake it\n^work.',
    type: { font: 'outfit', textCase: 'sentence', tracking: -0.04, leading: 0.1 },
    color: { background: '#c9c3f5', text: '#1b1d33' },
    effects: { shear: { enabled: true, skewX: 2, skewY: 12 } },
  },
  Italic: {
    text: 'All eyes\non *you.*',
    type: { font: 'dmsans', textCase: 'sentence', tracking: -0.04, leading: 0.1 },
    effects: { shear: { enabled: true, skewX: 12, skewY: 4 } },
  },
  Scattered: {
    text: 'All eyes\non *you.*',
    type: { font: 'outfit', textCase: 'sentence', tracking: -0.03 },
    effects: { jitter: { enabled: true }, shear: { enabled: true, skewY: 8 } },
  },
};

/* ---------------- deep assign (keeps object identity for UI bindings) ---------------- */

/** Copy matching values from `src` into `target`. Unknown keys, nulls, arrays and type mismatches are skipped,
 *  so a hand-edited or foreign file can never replace a section of the state with the wrong shape. */
export function assignDeep<T extends object>(target: T, src: DeepPartial<T> | undefined): T {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return target;
  for (const [k, v] of Object.entries(src)) {
    const key = k as keyof T;
    if (!(key in target) || v === null || v === undefined || Array.isArray(v)) continue;
    const cur = target[key];
    if (typeof v === 'object') {
      if (cur && typeof cur === 'object' && !Array.isArray(cur)) assignDeep(cur as object, v as object);
    } else if (typeof v === typeof cur && (typeof v !== 'number' || Number.isFinite(v))) {
      target[key] = v as T[keyof T];
    }
  }
  return target;
}

/** Replace `state` in place with defaults + preset. */
export function applyPreset(state: DesignState, preset: DeepPartial<DesignState>, keepText = false) {
  const text = state.text;
  assignDeep(state, defaultState());
  assignDeep(state, preset);
  legacyWeight(state, preset);
  if (keepText) state.text = text;
  sanitize(state);
}

/** Settings from before weights existed name a family but no weight: use the weight that family had then. */
function legacyWeight(state: DesignState, raw: unknown) {
  const t = (raw as { type?: { font?: unknown; weight?: unknown } } | null)?.type;
  if (t && typeof t === 'object' && typeof t.font === 'string' && t.font in FONTS && typeof t.weight !== 'number') {
    state.type.weight = FONTS[t.font as FontId].defaultWeight;
  }
}

function sanitize(state: DesignState) {
  for (const p of Object.values(state.effects)) p.amount = clampAmount(p.amount);
  if (!(state.type.font in FONTS)) state.type.font = defaultState().type.font; // the renderer and menus index FONTS directly
  state.type.weight = nearestWeight(state.type.font as FontId, state.type.weight);
}

/** A complete, valid state built from any partial or foreign settings object. */
export function cleanSettings(raw: unknown): DesignState {
  const state = defaultState();
  applyPreset(state, raw as DeepPartial<DesignState>);
  return state;
}

/* ---------------- randomize / mutate ---------------- */

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function numericControls(): { id: keyof EffectsState; key: string; c: Control }[] {
  return EFFECTS.flatMap((d) =>
    Object.entries(d.controls as Record<string, Control>)
      .filter(([, c]) => c.min !== undefined && c.max !== undefined)
      .map(([key, c]) => ({ id: d.id as keyof EffectsState, key, c })),
  );
}

function snap(v: number, c: Control): number {
  const step = c.step ?? 0.01;
  const clamped = Math.min(c.max!, Math.max(c.min!, v));
  return Math.round(clamped / step) * step;
}

/** New random effect stack. Text, type and colors are left alone. */
export function randomizeEffects(state: DesignState) {
  const e = state.effects as unknown as Record<string, Record<string, unknown>>;
  for (const { id, key, c } of numericControls()) {
    const [a, b] = c.random ?? [c.min!, c.max!];
    e[id][key] = snap(rnd(a, b), c);
  }
  const scopes = ['block', 'line', 'glyph'] as const;
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)];
  for (const p of Object.values(state.effects)) p.amount = 1;
  state.effects.jitter.enabled = Math.random() < 0.25;
  state.effects.shear.enabled = Math.random() < 0.85;
  state.effects.envelope.enabled = Math.random() < 0.5;
  state.effects.cloth.enabled = Math.random() < 0.55;
  state.effects.envelope.style = pick(['flag', 'arc', 'bulge', 'swell', 'rise'] as const);
  state.effects.jitter.scope = 'glyph';
  state.effects.shear.scope = Math.random() < 0.75 ? 'block' : 'line';
  state.effects.envelope.scope = Math.random() < 0.6 ? 'block' : pick(scopes);
  state.effects.cloth.scope = Math.random() < 0.65 ? 'block' : pick(scopes);
  state.effects.jitter.seed = Math.floor(rnd(1, 999));
  state.effects.envelope.phase = Math.round(rnd(-180, 180));
  state.effects.cloth.phase = Math.round(rnd(-180, 180));
}

/**
 * A sibling of the current look: two or three parameters of the enabled effects move a little.
 * Steps are sized against each control's Randomize range (the part of the slider that looks good),
 * and a move never carries a value further outside that range than it already was.
 */
export function mutateEffects(state: DesignState, amount = 0.12) {
  const e = state.effects as unknown as Record<string, Record<string, unknown>>;
  const pool = numericControls().filter(({ id, key }) => e[id].enabled && key !== 'seed');
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (const { id, key, c } of pool.slice(0, Math.random() < 0.5 ? 2 : 3)) {
    const cur = e[id][key] as number;
    const [a, b] = c.random ?? [c.min!, c.max!];
    // Controls without a Randomize range (phase) span a full circle; half of it keeps the step modest.
    const span = c.random ? b - a : (b - a) / 2;
    const lo = Math.min(a, cur);
    const hi = Math.max(b, cur);
    // Head away from an edge it's already against, and always move at least one slider step.
    let dir = Math.random() < 0.5 ? -1 : 1;
    if (cur + dir * (c.step ?? 0.01) > hi || cur + dir * (c.step ?? 0.01) < lo) dir = -dir;
    const dist = Math.max(rnd(0.3, 1) * span * amount, c.step ?? 0.01);
    e[id][key] = snap(Math.min(hi, Math.max(lo, cur + dir * dist)), c);
  }
}

/* ---------------- persistence ---------------- */

const KEY = 'warp-and-shear:v1';

export function loadSaved(): DesignState {
  const state = defaultState();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      assignDeep(state, parsed);
      legacyWeight(state, parsed);
    }
  } catch {
    /* private mode or corrupt data: start fresh */
  }
  sanitize(state);
  return state;
}

/** Returns false when the browser refused to store it (private mode, quota). */
export function save(state: DesignState): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}
