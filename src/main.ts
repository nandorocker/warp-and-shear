import { parse, type Font } from 'opentype.js';
import { buildScene, sceneToSvg, viewBox, type Scene } from './core/render';
import { buildPanel } from './panel';
import {
  FONTS,
  PRESETS,
  applyPreset,
  assignDeep,
  defaultState,
  loadSaved,
  mutateEffects,
  randomizeEffects,
  save,
  type FontId,
} from './state';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const textEl = $<HTMLTextAreaElement>('#text');
const artEl = $<HTMLDivElement>('#art');
const canvasEl = $<HTMLDivElement>('#canvas');
const statusEl = $<HTMLDivElement>('#status');

let firstVisit = false;
try {
  firstVisit = !localStorage.getItem('warp-and-shear:v1');
} catch {
  /* ignore */
}
const state = loadSaved();
if (firstVisit) applyPreset(state, PRESETS['Make it work']);
textEl.value = state.text;

/* ---------------- fonts ---------------- */

const fontCache = new Map<string, Promise<Font>>();
function getFont(id: string): Promise<Font> {
  const key = (id in FONTS ? id : 'dmsans') as FontId;
  let p = fontCache.get(key);
  if (!p) {
    p = fetch(import.meta.env.BASE_URL + FONTS[key].file)
      .then((r) => {
        if (!r.ok) throw new Error(`Font ${key}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => parse(buf));
    fontCache.set(key, p);
  }
  return p;
}

/* ---------------- render ---------------- */

let scene: Scene | null = null;
let font: Font | null = null;
let queued = false;
let saveTimer = 0;

function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(draw);
}

async function draw() {
  queued = false;
  try {
    font = await getFont(state.type.font);
  } catch (err) {
    statusEl.textContent = String(err);
    return;
  }
  const t0 = performance.now();
  scene = buildScene(font, state);
  // Preview uses lower precision; export uses full.
  artEl.innerHTML = sceneToSvg(scene, state, { precision: 1 });
  fitArt();
  const ms = performance.now() - t0;
  const [, , w, h] = viewBox(scene, state);
  const pts = scene.glyphs.reduce((n, g) => n + g.contours.reduce((m, c) => m + c.length / 2, 0), 0);
  statusEl.textContent = `${Math.round(w)} × ${Math.round(h)} · ${pts.toLocaleString()} points · ${ms.toFixed(0)} ms`;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => save(state), 250);
}

function fitArt() {
  const svg = artEl.querySelector('svg');
  if (!svg || !scene) return;
  const [, , w, h] = viewBox(scene, state);
  const cs = getComputedStyle(canvasEl);
  const aw = canvasEl.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const ah = canvasEl.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const k = Math.min(aw / w, ah / h);
  svg.setAttribute('width', String(Math.max(1, Math.floor(w * k))));
  svg.setAttribute('height', String(Math.max(1, Math.floor(h * k))));
}

new ResizeObserver(fitArt).observe(canvasEl);

/* ---------------- panel ---------------- */

const panel = buildPanel($('#pane'), state, {
  onChange: schedule,
  onPreset(name, keepText) {
    applyPreset(state, PRESETS[name], keepText);
    textEl.value = state.text;
    panel.refresh();
    schedule();
  },
  onResetEffects() {
    assignDeep(state.effects, defaultState().effects);
    panel.refresh();
    schedule();
  },
  onSaveJson() {
    download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), 'warp-and-shear.json');
  },
  onLoadJson() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        applyPreset(state, JSON.parse(await file.text()));
        textEl.value = state.text;
        panel.refresh();
        schedule();
      } catch (err) {
        statusEl.textContent = `Couldn't load settings: ${err}`;
      }
    };
    input.click();
  },
});

/* ---------------- text editing ---------------- */

textEl.addEventListener('input', () => {
  state.text = textEl.value;
  schedule();
});

/** Replace a range through execCommand so the browser's undo stack keeps working. */
function replaceRange(start: number, end: number, text: string, selStart: number, selEnd: number) {
  textEl.focus();
  textEl.setSelectionRange(start, end);
  if (!document.execCommand('insertText', false, text)) {
    textEl.setRangeText(text, start, end, 'end');
  }
  textEl.setSelectionRange(selStart, selEnd);
  state.text = textEl.value;
  schedule();
}

function toggleHighlight() {
  const { selectionStart: a, selectionEnd: b, value } = textEl;
  if (a === b) return;
  const sel = value.slice(a, b);
  if (sel.length >= 2 && sel.startsWith('*') && sel.endsWith('*')) {
    replaceRange(a, b, sel.slice(1, -1), a, b - 2);
  } else if (value[a - 1] === '*' && value[b] === '*') {
    replaceRange(a - 1, b + 1, sel, a - 1, b - 1);
  } else {
    replaceRange(a, b, `*${sel}*`, a + 1, b + 1);
  }
}

function stepLines(dir: 1 | -1) {
  const { selectionStart: a, selectionEnd: b, value } = textEl;
  const start = value.lastIndexOf('\n', a - 1) + 1;
  let end = value.indexOf('\n', Math.max(a, b - (b > a && value[b - 1] === '\n' ? 1 : 0)));
  if (end === -1) end = value.length;
  const lines = value.slice(start, end).split('\n');
  const out = lines.map((line) => {
    const m = /^[\^~]*/.exec(line)![0];
    let step = [...m].reduce((n, c) => n + (c === '^' ? 1 : -1), 0) + dir;
    const prefix = step > 0 ? '^'.repeat(step) : '~'.repeat(-step);
    return prefix + line.slice(m.length);
  });
  const text = out.join('\n');
  replaceRange(start, end, text, start, start + text.length);
}

textEl.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
    e.preventDefault();
    toggleHighlight();
  }
});

/* ---------------- actions ---------------- */

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSvg(): string | null {
  if (!scene) return null;
  return sceneToSvg(scene, state, { precision: 2, background: !state.output.transparent });
}

function fileBase(): string {
  const slug = state.text
    .replace(/[*^~\\]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return slug || 'warp-and-shear';
}

async function exportPng() {
  const svg = exportSvg();
  if (!svg || !scene) return;
  const [, , w, h] = viewBox(scene, state);
  const scale = Math.min(8, 4000 / Math.max(w, h));
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  c.toBlob((b) => b && download(b, `${fileBase()}.png`), 'image/png');
}

const actions: Record<string, () => void> = {
  hl: toggleHighlight,
  up: () => stepLines(1),
  down: () => stepLines(-1),
  randomize: () => {
    randomizeEffects(state);
    panel.refresh();
    schedule();
  },
  mutate: () => {
    mutateEffects(state);
    panel.refresh();
    schedule();
  },
  svg: () => {
    const svg = exportSvg();
    if (svg) download(new Blob([svg], { type: 'image/svg+xml' }), `${fileBase()}.svg`);
  },
  png: () => void exportPng(),
  copy: async () => {
    const svg = exportSvg();
    if (!svg) return;
    try {
      await navigator.clipboard.writeText(svg);
      statusEl.textContent = 'SVG copied to clipboard';
    } catch {
      statusEl.textContent = 'Clipboard unavailable here (needs HTTPS); use the SVG button';
    }
  },
};

document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-act]');
  if (btn) actions[btn.dataset.act!]?.();
});

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('textarea, input, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'r') actions.randomize();
  if (e.key === 'm') actions.mutate();
});

schedule();
