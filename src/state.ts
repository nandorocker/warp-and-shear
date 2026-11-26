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
    // Neutral on purpose (this is what Reset all returns to); only the highlight keeps our violet.
    color: { background: '#ffffff', text: '#111111', highlight: '#5a3ee0' }, // highlight = PAL.violet
    effects: defaultEffects(),
    output: { aspect: 'fit', padding: 0.08, transparent: true },
  };
}

/* ---------------- presets ---------------- */

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Brand-poster palette the built-in presets draw from. */
const PAL = {
  cream: '#f8f2ee',
  navy: '#182033',
  lavender: '#d4c9fd',
  blue: '#c7d9f1',
  orange: '#ff5930',
  violet: '#5a3ee0', // highlight on lavender, where orange would clash
  white: '#fbf8f7',
  ink: '#111111',
};

export const PRESETS: Record<string, DeepPartial<DesignState>> = {
  'Waving flag': {
    type: { font: 'archivo', textCase: 'upper', tracking: -0.01, leading: 0.1, fit: 0.5 },
    color: { background: PAL.cream, text: PAL.ink, highlight: PAL.orange },
    effects: {
      shear: { enabled: true, skewX: 6 },
      envelope: { enabled: true, style: 'flag', bend: 0.21, waves: 1, phase: -3 },
      cloth: { enabled: true, depth: 0.55, waves: 1, phase: 20, diagonal: 0.3, pole: 0.35, turn: -6.5, tilt: 9, perspective: 0.7 },
    },
  },
  Climb: {
    type: { font: 'dmsans', textCase: 'sentence', tracking: -0.04, leading: 0.06, fit: 1 },
    color: { background: PAL.blue, text: PAL.navy, highlight: PAL.orange },
    effects: { shear: { enabled: true, skewX: 8, skewY: 4 } },
  },
  Swoosh: {
    type: { font: 'archivo', textCase: 'upper', tracking: -0.01, leading: 0.1, fit: 0.5 },
    color: { background: PAL.navy, text: PAL.white, highlight: PAL.orange },
    effects: {
      shear: { enabled: true, skewX: 9 },
      envelope: { enabled: true, style: 'flag', bend: 0.35, waves: 0.6, phase: -30, hPersp: 0.35 },
    },
  },
  'Billowing sheet': {
    type: { font: 'archivo', textCase: 'upper', tracking: -0.01, leading: 0.1, fit: 0.5 },
    color: { background: PAL.lavender, text: PAL.navy, highlight: PAL.violet },
    effects: {
      shear: { enabled: true, skewX: 9 },
      cloth: { enabled: true, depth: 0.9, waves: 0.75, phase: 40, turn: 12, tilt: 25, perspective: 0.8 },
    },
  },
  'Side turn': {
    type: { font: 'archivo', textCase: 'upper', tracking: -0.01, leading: 0.04, stretchX: 0.9 },
    color: { background: PAL.cream, text: PAL.navy, highlight: PAL.orange },
    effects: {
      shear: { enabled: true, skewX: -4, skewY: 6 },
      cloth: { enabled: true, depth: 0.45, waves: 0.8, phase: 120, turn: -28, tilt: 0, perspective: 0.6 },
    },
  },
  /* Slice warp looks: rails are stored by role (top, between lines, bottom), so they carry over to any text. */
  'Wavy hem': {
    type: { font: 'archivo', textCase: 'upper', tracking: -0.01, leading: 0.05, stepRatio: 1.45 },
    color: { background: PAL.lavender, text: PAL.navy, highlight: PAL.violet },
    effects: {
      shear: { enabled: true, skewX: 7 },
      slice: {
        enabled: true,
        rails: {
          m2: { ry: 0.02, p1: -0.01, p3: 0.01 },
          bottom: { ly: 0.12, ry: -0.03, p1: 0.05, p2: -0.02, p3: 0.03 },
        },
      },
    },
  },
  Crescendo: {
    type: { font: 'archivo', textCase: 'upper', tracking: -0.01, leading: 0.05, stretchX: 0.7, fit: 1 },
    color: { background: PAL.cream, text: PAL.navy, highlight: PAL.orange },
    effects: { slice: { enabled: true, taper: 20, grow: 30, pinch: 6, zigzag: 6 } },
  },
  Scattered: {
    type: { font: 'outfit', weight: 800, textCase: 'upper', tracking: -0.03, leading: -0.075 },
    color: { background: PAL.lavender, text: PAL.navy, highlight: PAL.violet },
    effects: { jitter: { enabled: true, amount: 1.14, shiftX: 0.05 }, shear: { enabled: true, skewY: 8 } },
  },
};

/** The text a first-time visitor sees. */
export const WELCOME_TEXT = 'Bend it\nlike you\n*mean* it';

/** First visit: the welcome text in one of the built-in presets, picked at random so the app opens on a real look. */
export function applyWelcome(state: DesignState, pick = Math.random()) {
  const names = Object.keys(PRESETS);
  const name = names[Math.min(names.length - 1, Math.floor(pick * names.length))];
  applyPreset(state, { ...PRESETS[name], text: WELCOME_TEXT });
}

/** Restore the editor defaults and clear the text. */
export function applyReset(state: DesignState) {
  applyPreset(state, { text: '' });
}

/** Reset typography and colors. Curve step is an Output control. */
export function applyResetStyles(state: DesignState) {
  const { type: { detail: _detail, ...type }, color } = defaultState();
  assignDeep(state, { type, color });
}

/** Restore the effect settings and turn the effects off. */
export function applyResetEffects(state: DesignState) {
  assignDeep(state.effects, defaultEffects());
}

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
  state.effects.slice.scope = 'block'; // its rails are line boundaries, so it only makes sense on the block
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
  // Slice's hand-drawn rails (and its amount) are left alone; only its named shapes are rerolled.
  for (const [id, p] of Object.entries(state.effects)) if (id !== 'slice') p.amount = 1;
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
