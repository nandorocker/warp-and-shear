import { EFFECTS, clampAmount, type Control, type EffectsState } from './core/effects';
import type { DesignState } from './core/render';

export const FONTS = {
  dmsans: { label: 'DM Sans Black', file: 'fonts/DMSans-Black-Display.ttf' },
  outfit: { label: 'Outfit SemiBold', file: 'fonts/Outfit-SemiBold.ttf' },
  archivo: { label: 'Archivo Black Condensed', file: 'fonts/Archivo-Black-Condensed.ttf' },
} as const;

export type FontId = keyof typeof FONTS;

function defaultEffects(): EffectsState {
  return Object.fromEntries(EFFECTS.map((d) => [d.id, structuredClone(d.defaults)])) as unknown as EffectsState;
}

export function defaultState(): DesignState {
  return {
    text: 'All eyes\non *you.*',
    type: {
      font: 'dmsans',
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

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export const PRESETS: Record<string, DeepPartial<DesignState>> = {
  'Sabbath flag': {
    text: 'The human\n^edge.',
    type: { font: 'archivo', textCase: 'upper', tracking: -0.01, leading: 0.1, fit: 0.5 },
    effects: {
      shear: { enabled: true, skewX: 9 },
      envelope: { enabled: true, style: 'flag', bend: 0.35, waves: 0.6, phase: -30, hPersp: 0.35 },
    },
  },
  'Make it work': {
    text: 'Make it up.\nMake it\n^^work.',
    type: { font: 'dmsans', textCase: 'upper', tracking: -0.02, leading: 0.2 },
    color: { background: '#c9c3f5', text: '#1b1d33' },
    effects: {
      shear: { enabled: true, skewX: 8 },
      cloth: { enabled: true, scope: 'line', depth: 0.5, waves: 0.6, phase: 60, stagger: 40, turn: 20, tilt: 10, perspective: 0.6 },
    },
  },
  'Cloth tilt': {
    text: 'The human\n^edge.',
    type: { font: 'archivo', textCase: 'upper', tracking: -0.01, leading: 0.1, fit: 0.5 },
    effects: {
      shear: { enabled: true, skewX: 9 },
      cloth: { enabled: true, depth: 0.9, waves: 0.75, phase: 40, turn: 12, tilt: 25, perspective: 0.8 },
    },
  },
  'All eyes on you': {
    text: 'All\neyes\non *you.*',
    type: { font: 'archivo', textCase: 'upper', tracking: -0.01, leading: 0.04, stretchX: 0.9 },
    effects: {
      shear: { enabled: true, skewX: -4, skewY: 6 },
      cloth: { enabled: true, depth: 0.45, waves: 0.8, phase: 120, turn: -28, tilt: 0, perspective: 0.6 },
    },
  },
  Lean: {
    text: 'Human\nedge.',
    type: { font: 'dmsans', textCase: 'sentence', tracking: -0.04, leading: 0.1 },
    color: { background: '#d4deee', text: '#111111' },
    effects: { shear: { enabled: true, skewX: 12, skewY: 14 } },
  },
  Rise: {
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
  Jitter: {
    text: 'All eyes\non *you.*',
    type: { font: 'outfit', textCase: 'sentence', tracking: -0.03 },
    effects: { jitter: { enabled: true }, shear: { enabled: true, skewY: 8 } },
  },
};

/* ---------------- deep assign (keeps object identity for UI bindings) ---------------- */

export function assignDeep<T extends object>(target: T, src: DeepPartial<T> | undefined): T {
  if (!src) return target;
  for (const [k, v] of Object.entries(src)) {
    const key = k as keyof T;
    if (!(key in target)) continue;
    const cur = target[key];
    if (v && typeof v === 'object' && cur && typeof cur === 'object') {
      assignDeep(cur as object, v as object);
    } else if (v !== undefined && typeof v === typeof cur) {
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
  if (keepText) state.text = text;
  sanitize(state);
}

function sanitize(state: DesignState) {
  for (const p of Object.values(state.effects)) p.amount = clampAmount(p.amount);
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

/** Small nudge to every parameter of the enabled effects. */
export function mutateEffects(state: DesignState, amount = 0.08) {
  const e = state.effects as unknown as Record<string, Record<string, unknown>>;
  for (const { id, key, c } of numericControls()) {
    if (!e[id].enabled || key === 'seed') continue;
    const span = c.max! - c.min!;
    e[id][key] = snap((e[id][key] as number) + rnd(-1, 1) * span * amount, c);
  }
}

/* ---------------- persistence ---------------- */

const KEY = 'warp-and-shear:v1';

export function loadSaved(): DesignState {
  const state = defaultState();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) assignDeep(state, JSON.parse(raw));
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
