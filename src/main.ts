import { parse, type Font } from 'opentype.js';
import { buildScene, sceneToSvg, viewBox, type Scene } from './core/render';
import { EFFECTS } from './core/effects';
import { createHistory } from './history';
import { attachMenu } from './menu';
import { buildPanel } from './panel';
import {
  FONTS,
  PRESETS,
  applyPreset,
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
const statusEl = $<HTMLSpanElement>('#status');
const savedEl = $<HTMLSpanElement>('#saved');
const toastEl = $<HTMLSpanElement>('#toast');
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.userAgent);

let firstVisit = false;
try {
  firstVisit = !localStorage.getItem('warp-and-shear:v1');
} catch {
  /* ignore */
}
const state = loadSaved();
if (firstVisit) applyPreset(state, PRESETS['Make it work']);
textEl.value = state.text;

const history = createHistory(() => state, updateHistoryButtons);
history.commit();

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

/** Redraw only (no history step): used after restoring a snapshot. */
function requestDraw() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(draw);
}

/** A design edit happened: redraw, and record a history step once edits settle. */
function schedule() {
  history.commitSoon();
  requestDraw();
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
  saveTimer = window.setTimeout(() => {
    savedEl.textContent = save(state) ? '✓ Autosaved' : 'Not saved: browser storage is unavailable';
  }, 250);
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

type Snapshot = Parameters<typeof applyPreset>[1];

const panel = buildPanel($('#pane'), state, { onChange: schedule });
history.rebase(); // Tweakpane may have normalised values while binding; make that the baseline

/** Re-sync every control with `state` after it was replaced wholesale (preset, undo, load…). */
function syncUi() {
  textEl.value = state.text;
  panel.refresh();
  syncExportUi();
}

/** Run a discrete, whole-design action as its own undo step. */
function change(fn: () => void, note?: string) {
  history.commit(); // flush any edit still settling so it stays a separate step
  fn();
  syncUi();
  schedule();
  const added = history.commit();
  if (note && added) showToast(note, 'Undo', undo);
}

function restore(snap: unknown) {
  if (!snap) return;
  applyPreset(state, snap as Snapshot);
  syncUi(); // controls may adjust values (steps, limits) as they re-read state...
  history.rebase(); // ...so record the settled state, or it would look like a new edit
  requestDraw();
}

function undo() {
  restore(history.undo());
  hideToast();
}

function redo() {
  restore(history.redo());
}

function updateHistoryButtons() {
  if (!toastEl.hidden && history.position !== toastPos) hideToast(); // history moved on: the notice is stale
  document.querySelector<HTMLButtonElement>('[data-act=undo]')!.disabled = !history.canUndo;
  document.querySelector<HTMLButtonElement>('[data-act=redo]')!.disabled = !history.canRedo;
}

/* ---------------- toast ---------------- */

let toastTimer = 0;
let toastPos = -1;

function hideToast() {
  clearTimeout(toastTimer);
  toastEl.hidden = true;
}

function showToast(message: string, actionLabel: string, onAction: () => void) {
  toastPos = history.position;
  const text = document.createElement('span');
  text.textContent = message;
  const btn = document.createElement('button');
  btn.textContent = actionLabel;
  btn.addEventListener('click', () => {
    history.commit(); // an edit still settling would otherwise be what gets undone
    const current = history.position === toastPos;
    hideToast();
    if (current) onAction();
  });
  toastEl.replaceChildren(text, btn);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 8000);
}

/* ---------------- settings files ---------------- */

function saveSettings() {
  download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), 'warp-and-shear.json');
}

function openSettings() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Snapshot;
      change(() => applyPreset(state, parsed));
    } catch (err) {
      statusEl.textContent = `Couldn't load settings: ${err}`;
    }
  };
  input.click();
}

/* ---------------- menus ---------------- */

const keepTextEl = $<HTMLButtonElement>('#keep-text');
const transparentEl = $<HTMLButtonElement>('#transparent');
const isOn = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true';
const setOn = (el: HTMLElement, on: boolean) => el.setAttribute('aria-checked', String(on));
keepTextEl.addEventListener('click', () => setOn(keepTextEl, !isOn(keepTextEl)));
const frameChips = $<HTMLDivElement>('#frame-chips');

attachMenu($('#presets-wrap'), $<HTMLButtonElement>('#presets-btn'), $('#presets-menu'));
attachMenu($('#export-wrap'), $<HTMLButtonElement>('#export-btn'), $('#export-menu'));

// Presets: swatch in the preset's own colors, plus the font and effects it switches on.
{
  const base = defaultState();
  const list = $('#preset-list');
  for (const [name, p] of Object.entries(PRESETS)) {
    const btn = document.createElement('button');
    btn.setAttribute('role', 'menuitem');
    const fontId = (p.type?.font ?? base.type.font) as FontId;
    const fx = Object.entries((p.effects ?? {}) as Record<string, { enabled?: boolean }>)
      .filter(([, v]) => v?.enabled)
      .map(([id]) => EFFECTS.find((d) => d.id === id)?.label.toLowerCase() ?? id);
    const wrap = document.createElement('span');
    wrap.className = 'preset';
    const th = document.createElement('span');
    th.className = 'th';
    th.textContent = 'Aa';
    th.style.background = p.color?.background ?? base.color.background;
    th.style.color = p.color?.text ?? base.color.text;
    const label = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = name;
    const small = document.createElement('small');
    small.textContent = [FONTS[fontId].label.replace(/\s+(Black|SemiBold|Condensed).*$/, ''), ...fx].join(' · ');
    label.append(b, small);
    wrap.append(th, label);
    btn.append(wrap);
    btn.addEventListener('click', () => change(() => applyPreset(state, p, isOn(keepTextEl))));
    list.append(btn);
  }
}

// Frame + transparency live in the export menu, since that's when they matter.
const FRAMES: [string, string][] = [
  ['fit', 'Fit'],
  ['1:1', '1:1'],
  ['4:5', '4:5'],
  ['3:4', '3:4'],
  ['16:9', '16:9'],
  ['9:16', '9:16'],
];
for (const [value, label] of FRAMES) {
  const chip = document.createElement('button');
  chip.className = 'chip';
  chip.setAttribute('role', 'menuitemradio');
  chip.dataset.value = value;
  chip.textContent = label;
  chip.addEventListener('click', () => {
    state.output.aspect = value as typeof state.output.aspect;
    syncExportUi();
    schedule();
  });
  frameChips.append(chip);
}
transparentEl.addEventListener('click', () => {
  state.output.transparent = !isOn(transparentEl);
  syncExportUi();
  schedule();
});

function syncExportUi() {
  for (const chip of frameChips.querySelectorAll<HTMLElement>('.chip')) {
    chip.setAttribute('aria-checked', String(chip.dataset.value === state.output.aspect));
  }
  setOn(transparentEl, state.output.transparent);
}
syncExportUi();

/* Show ⌘ on macOS and Ctrl elsewhere. */
function shortcutLabel(spec: string): string {
  const keys = spec.split('+');
  const key = keys.pop()!.toUpperCase();
  if (IS_MAC) return `${keys.includes('shift') ? '⇧' : ''}${keys.includes('mod') ? '⌘' : ''}${key}`;
  return [...keys.map((k) => (k === 'mod' ? 'Ctrl' : 'Shift')), key].join('+');
}
for (const el of document.querySelectorAll<HTMLElement>('[data-kbd]')) el.textContent = shortcutLabel(el.dataset.kbd!);
if (!IS_MAC) {
  for (const el of document.querySelectorAll<HTMLElement>('[title*="⌘"]')) {
    if (!el.title.includes('Ctrl')) el.title = el.title.replace('⇧⌘', 'Ctrl+Shift+').replace('⌘', 'Ctrl+');
  }
}

const actions: Record<string, () => void> = {
  hl: toggleHighlight,
  up: () => stepLines(1),
  down: () => stepLines(-1),
  randomize: () => change(() => randomizeEffects(state)),
  mutate: () => change(() => mutateEffects(state)),
  undo,
  redo,
  reset: () => change(() => applyPreset(state, {}, true), 'Reset to defaults'), // type, colors, effects, output; text stays
  open: openSettings,
  save: saveSettings,
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
  const el = e.target instanceof Element ? e.target : null;
  // Plain keys (R, M) stay out of any form control; ⌘Z only defers to controls that have their own text undo.
  const typing = !!el?.closest('textarea, input, select');
  const textField = !!el?.closest('textarea, input:not([type=checkbox], [type=radio], [type=range], [type=color], [type=button])');
  const mod = IS_MAC ? e.metaKey : e.ctrlKey; // on a Mac, Ctrl+E/O are text-editing keys
  const key = e.key.toLowerCase();
  if (mod) {
    if (e.altKey) return;
    // Inside a text field, ⌘Z belongs to the field's own undo.
    if (key === 'z' && !textField) {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (key === 'y' && !textField) {
      e.preventDefault();
      redo();
    } else if (key === 's') {
      e.preventDefault();
      saveSettings();
    } else if (key === 'o') {
      e.preventDefault();
      openSettings();
    } else if (key === 'e') {
      e.preventDefault();
      if (e.shiftKey) void exportPng();
      else actions.svg();
    }
    return;
  }
  if (typing || e.altKey) return;
  if (key === 'r') actions.randomize();
  if (key === 'm') actions.mutate();
});

schedule();
