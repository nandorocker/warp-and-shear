import { parse, type Font } from 'opentype.js';
import { buildScene, sceneToSvg, viewBox, type Scene } from './core/render';
import { EFFECTS } from './core/effects';
import { createHistory } from './history';
import {
  NAME_MAX,
  addPreset,
  cleanName,
  deletePreset,
  importPresets,
  libraryFile,
  list as listPresets,
  loadLibrary,
  parseFile,
  startFresh,
  presetFile,
  renamePreset,
  restorePreset,
  slug,
  uniqueName,
  type UserPreset,
} from './library';
import { attachMenu } from './menu';
import { buildPanel } from './panel';
import {
  FONTS,
  PRESETS,
  applyPreset,
  applyWelcome,
  WEIGHT_NAMES,
  defaultState,
  fontFile,
  loadSaved,
  nearestWeight,
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
if (firstVisit) applyWelcome(state);
textEl.value = state.text;

const history = createHistory(() => state, updateHistoryButtons);
history.commit();

/* ---------------- fonts ---------------- */

const fontCache = new Map<string, Promise<Font>>();
function getFont(id: string, weight: number): Promise<Font> {
  const fid = (id in FONTS ? id : 'dmsans') as FontId;
  const file = fontFile(fid, nearestWeight(fid, weight));
  let p = fontCache.get(file);
  if (!p) {
    p = fetch(import.meta.env.BASE_URL + file)
      .then((r) => {
        if (!r.ok) throw new Error(`Font ${file}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((buf) => parse(buf));
    p.catch(() => fontCache.delete(file)); // let a later draw retry after a network hiccup
    fontCache.set(file, p);
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
  const wanted = `${state.type.font}:${state.type.weight}`;
  try {
    font = await getFont(state.type.font, state.type.weight);
  } catch (err) {
    statusEl.textContent = String(err);
    return;
  }
  // A slow font load can finish after the choice moved on: draw with the current one instead of a stale result.
  if (`${state.type.font}:${state.type.weight}` !== wanted) return requestDraw();
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

// Toolbar clicks shouldn't pull focus out of the text, so the selection stays visible.
$('.toolbar').addEventListener('mousedown', (e) => e.preventDefault());

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
  if (note && added) showToast(note, { label: 'Undo', run: undo, history: true });
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
  if (toastPos !== -1) hideToast(); // a preset-delete Undo is unrelated to design history: leave it
}

function redo() {
  restore(history.redo());
}

function updateHistoryButtons() {
  if (!toastEl.hidden && toastPos !== -1 && history.position !== toastPos) hideToast(); // history moved on: the notice is stale
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

/** A short notice in the status bar. With `history`, the action is a design undo and the notice expires once the
 *  design history moves on; without it (e.g. undoing a preset delete) it survives later edits. */
function showToast(message: string, action?: { label: string; run: () => void; history?: boolean }) {
  toastPos = action?.history ? history.position : -1;
  const text = document.createElement('span');
  text.textContent = message;
  toastEl.replaceChildren(text);
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      if (action.history) history.commit(); // an edit still settling would otherwise be what gets undone
      const current = toastPos === -1 || history.position === toastPos;
      hideToast();
      if (current) action.run();
    });
    toastEl.append(btn);
  }
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 8000);
}

/* ---------------- menus ---------------- */

const transparentEl = $<HTMLButtonElement>('#transparent');
const isOn = (el: HTMLElement) => el.getAttribute('aria-checked') === 'true';
const setOn = (el: HTMLElement, on: boolean) => el.setAttribute('aria-checked', String(on));
const frameChips = $<HTMLDivElement>('#frame-chips');

const presetsMenu = attachMenu($('#presets-wrap'), $<HTMLButtonElement>('#presets-btn'), $('#presets-menu'));
attachMenu($('#export-wrap'), $<HTMLButtonElement>('#export-btn'), $('#export-menu'));

/* ---------------- presets ---------------- */

const presetListEl = $<HTMLDivElement>('#preset-list');
const savePresetBtn = $<HTMLButtonElement>('#save-preset');
const saveForm = $<HTMLFormElement>('#save-form');
const saveNameEl = $<HTMLInputElement>('#save-name');
const exportAllBtn = $<HTMLButtonElement>('#export-all');

const svgIcon = (body: string, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  export: svgIcon('<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>'),
  rename: svgIcon('<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>'),
  delete: svgIcon('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>'),
  close: svgIcon('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  more: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
};

let renamingId: string | null = null;

{
  const { error } = loadLibrary();
  if (error)
    showToast(error, {
      label: 'Start fresh',
      run: () => {
        const err = startFresh();
        showToast(err ?? 'Started a new preset list. The old data is kept as a backup in browser storage.');
        renderPresets();
      },
    });
}

/** Swatch in the preset's own colors, its name, and the font and effects it switches on. */
function presetLabel(name: string, p: Snapshot): HTMLElement {
  const base = defaultState();
  const fontId = (p.type?.font && p.type.font in FONTS ? p.type.font : base.type.font) as FontId;
  const weight = nearestWeight(fontId, p.type?.weight ?? FONTS[fontId].defaultWeight);
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
  small.textContent = [`${FONTS[fontId].label.replace(/ Condensed$/, '')} ${WEIGHT_NAMES[weight]}`, ...fx].join(' · ');
  label.append(b, small);
  wrap.append(th, label);
  return wrap;
}

/** A preset is style only, so saving leaves the text out. */
function withoutText({ text: _text, ...style }: typeof state) {
  return style;
}

function applyPresetSettings(p: Snapshot) {
  change(() => applyPreset(state, p, true)); // presets are style only: your text stays
}

function actionButton(cls: string, label: string, icon: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = cls;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.innerHTML = `${icon}<span class="lbl">${label}</span>`;
  btn.addEventListener('click', onClick);
  return btn;
}

function closeRowActions() {
  for (const row of presetListEl.querySelectorAll('.preset-row.open')) {
    row.classList.remove('open');
    row.querySelector('.preset-more')?.setAttribute('aria-expanded', 'false');
  }
}

function userRow(p: UserPreset): HTMLElement {
  const row = document.createElement('div');
  row.className = 'preset-row';
  row.dataset.id = p.id;

  if (renamingId === p.id) {
    row.classList.add('renaming');
    const label = presetLabel(p.name, p.settings);
    const input = document.createElement('input');
    input.className = 'rename-input';
    input.value = p.name;
    input.maxLength = NAME_MAX;
    input.setAttribute('aria-label', `Rename ${p.name}`);
    label.lastElementChild!.replaceWith(input);
    let done = false;
    const finish = (commit: boolean, viaBlur = false) => {
      if (done) return;
      done = true;
      renamingId = null;
      const err = commit ? renamePreset(p.id, input.value) : null;
      if (err) showToast(err);
      if (!viaBlur) return renderPresets(p.id);
      // Focus is moving elsewhere (a click, Tab, ⌘S): rebuild after it lands, and only take focus back if it went nowhere.
      setTimeout(() => {
        const lost = !document.activeElement || document.activeElement === document.body;
        renderPresets(lost ? p.id : undefined);
      });
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.stopPropagation(); // cancel the rename, keep the menu open
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true, true));
    row.append(label);
    return row;
  }

  const main = document.createElement('button');
  main.className = 'preset-main';
  main.setAttribute('role', 'menuitem');
  main.append(presetLabel(p.name, p.settings));
  main.addEventListener('click', () => applyPresetSettings(p.settings));

  const acts = document.createElement('span');
  acts.className = 'preset-acts';
  acts.append(
    actionButton('exp', 'Export', ICON.export, () => {
      closeRowActions();
      download(new Blob([presetFile(p)], { type: 'application/json' }), `${slug(p.name)}.json`);
    }),
    actionButton('ren', 'Rename', ICON.rename, () => {
      renamingId = p.id;
      renderPresets();
    }),
    actionButton('del', 'Delete', ICON.delete, () => deleteUserPreset(p.id)),
    actionButton('x', 'Close', ICON.close, () => {
      closeRowActions();
      more.focus();
    }),
  );

  // Touch only (CSS): slides the actions in over the row.
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'preset-more';
  more.setAttribute('aria-label', `Actions for ${p.name}`);
  more.setAttribute('aria-expanded', 'false');
  more.innerHTML = ICON.more;
  more.addEventListener('click', () => {
    closeRowActions();
    row.classList.add('open');
    more.setAttribute('aria-expanded', 'true');
    acts.querySelector<HTMLButtonElement>('button')?.focus();
  });

  row.append(main, acts, more);
  return row;
}

function builtInRow(name: string, p: Snapshot): HTMLElement {
  const row = document.createElement('div');
  row.className = 'preset-row';
  const main = document.createElement('button');
  main.className = 'preset-main';
  main.setAttribute('role', 'menuitem');
  main.append(presetLabel(name, p));
  main.addEventListener('click', () => applyPresetSettings(p));
  row.append(main);
  return row;
}

function sectionLabel(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'menu-label section';
  el.textContent = text;
  return el;
}

/** Rebuild the list. `focusId` puts keyboard focus back on that saved preset (after a rename, or a new save). */
function renderPresets(focusId?: string) {
  const mine = listPresets();
  const rows: HTMLElement[] = [];
  if (mine.length) rows.push(sectionLabel('My presets'), ...mine.map(userRow));
  rows.push(sectionLabel('Built-in'), ...Object.entries(PRESETS).map(([name, p]) => builtInRow(name, p)));
  presetListEl.replaceChildren(...rows);
  exportAllBtn.disabled = !mine.length;

  const input = presetListEl.querySelector<HTMLInputElement>('.rename-input');
  if (input) {
    input.focus();
    input.select();
  } else if (focusId && presetsMenu.isOpen) {
    presetListEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"] .preset-main`)?.focus();
  }
}

function deleteUserPreset(id: string) {
  const rows = [...presetListEl.querySelectorAll<HTMLElement>('.preset-main')];
  const at = rows.findIndex((el) => el.closest<HTMLElement>('.preset-row')?.dataset.id === id);
  const { removed, index, error } = deletePreset(id);
  if (error) showToast(error);
  if (!removed) return;
  renderPresets();
  // Keep keyboard focus in the list: the row that took its place, or the last one.
  const after = presetListEl.querySelectorAll<HTMLElement>('.preset-main');
  (after[Math.min(at, after.length - 1)] ?? savePresetBtn).focus();
  showToast(`Deleted “${removed.name}”`, {
    label: 'Undo',
    run: () => {
      const err = restorePreset(removed, index);
      if (err) showToast(err);
      renderPresets();
    },
  });
}

/* Saving: the menu item turns into a name field. */
function suggestedName(): string {
  const first = state.text.split('\n').find((l) => l.trim()) ?? '';
  return uniqueName(cleanName(first.replace(/\\(.)/g, '$1').replace(/[*^~]/g, ''), 'My preset'));
}

function openSaveForm() {
  if (!saveForm.hidden && presetsMenu.isOpen) return saveForm.requestSubmit(); // ⌘S again = save what's typed
  if (!presetsMenu.isOpen) {
    presetsMenu.open();
    renamingId = null;
    loadLibrary();
    renderPresets();
  }
  closeRowActions();
  savePresetBtn.hidden = true;
  saveForm.hidden = false;
  saveNameEl.value = suggestedName();
  saveNameEl.focus();
  saveNameEl.select();
}

function closeSaveForm(focusButton = false) {
  if (saveForm.hidden) return;
  saveForm.hidden = true;
  savePresetBtn.hidden = false;
  if (focusButton) savePresetBtn.focus();
}

savePresetBtn.addEventListener('click', openSaveForm);
saveForm.addEventListener('submit', (e) => {
  e.preventDefault();
  history.commit();
  const { preset, error } = addPreset(saveNameEl.value || suggestedName(), withoutText(state));
  closeSaveForm(!preset);
  renderPresets(preset?.id);
  if (error) showToast(error);
  else if (preset) showToast(`Saved “${preset.name}”`);
});
saveNameEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.stopPropagation(); // cancel saving, keep the menu open
    closeSaveForm(true);
  }
});
saveForm.addEventListener('focusout', (e) => {
  if (!saveForm.contains(e.relatedTarget as Node | null)) closeSaveForm();
});

// Each time the menu opens it starts clean: no half-typed name, no open row actions.
$('#presets-btn').addEventListener('click', () => {
  if (!presetsMenu.isOpen) return;
  closeSaveForm();
  renamingId = null;
  loadLibrary();
  renderPresets();
});
// A tap outside an open row's actions closes them (touch).
document.addEventListener('pointerdown', (e) => {
  const open = presetListEl.querySelector('.preset-row.open');
  if (open && !open.contains(e.target as Node)) closeRowActions();
});

/* Files: import adds to My presets (and applies a single preset); export all is a backup of My presets. */
function importFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const entries = parseFile(await file.text(), file.name);
      if (!entries.length) throw new Error('there are no presets in it');
      const { added, skipped, error } = importPresets(entries);
      renderPresets();
      if (entries.length === 1) applyPresetSettings(entries[0].settings);
      if (error) showToast(error);
      else
        showToast(
          entries.length === 1
            ? added.length
              ? `Imported “${added[0].name}”`
              : `“${entries[0].name}” is already saved`
            : `Imported ${added.length} preset${added.length === 1 ? '' : 's'}${skipped ? ` · ${skipped} already saved` : ''}`,
        );
    } catch (err) {
      showToast(`Couldn't import ${file.name}: ${err instanceof Error ? err.message : err}`);
    }
  };
  input.click();
}

function exportAll() {
  if (!listPresets().length) return;
  download(new Blob([libraryFile()], { type: 'application/json' }), 'warp-and-shear-presets.json');
}

renderPresets();

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
  reset: () => change(() => applyWelcome(state), 'Reset to start'), // back to exactly what a first visit shows
  import: importFile,
  'export-all': exportAll,
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
      openSaveForm();
    } else if (key === 'o') {
      e.preventDefault();
      importFile();
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
