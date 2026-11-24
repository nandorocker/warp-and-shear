import { Pane, type FolderApi } from 'tweakpane';
import { AMOUNT_MAX, EFFECTS, type Control, type EffectsState } from './core/effects';
import type { DesignState } from './core/render';
import { FONTS, WEIGHT_NAMES, defaultState, nearestWeight, type FontId } from './state';
import { clothWidget } from './widgets/cloth';
import { envelopeWidget } from './widgets/envelope';

type BindParams = NonNullable<Parameters<FolderApi['addBinding']>[2]>;

export interface PanelHooks {
  onChange(): void;
}

const SCOPES = { Block: 'block', Line: 'line', Glyph: 'glyph' };

/** Builds the control panel. Effect sections are generated from each effect's control schema. */
export function buildPanel(container: HTMLElement, state: DesignState, hooks: PanelHooks) {
  const pane = new Pane({ container });
  const syncers: (() => void)[] = [];
  const widgets: { render(): void }[] = [];
  let refreshing = false;

  /* Reset-to-default: every numeric field gets a small icon (visible only once it differs from the app default).
     Number fields without a slider range get a compact input so the icon sits right next to the value. */
  const defaults = defaultState();
  const resets: (() => void)[] = [];
  const updateResets = () => resets.forEach((u) => u());
  const same = (a: unknown, b: unknown) =>
    typeof a === 'number' && typeof b === 'number'
      ? Math.abs(a - b) < 1e-9
      : String(a).toLowerCase() === String(b).toLowerCase();

  function bindR(folder: FolderApi, obj: object, def: object, key: string, params: BindParams = {}) {
    const rec = obj as Record<string, unknown>;
    const fallback = (def as Record<string, unknown>)[key];
    // A trailing "°" or "%" in the label is a unit: show it inside the value field, where it can't be edited away.
    const unit = typeof params.label === 'string' ? (params.label.match(/\s*([°%])$/)?.[1] ?? '') : '';
    if (unit) params = { ...params, label: (params.label as string).replace(/\s*[°%]$/, '') };
    const b = folder.addBinding(rec, key, params);
    const field = unit ? b.element.querySelector('.tp-txtv') : null;
    if (field) {
      const u = document.createElement('span');
      u.className = 'unit';
      u.textContent = unit;
      u.setAttribute('aria-hidden', 'true');
      field.classList.add('has-unit');
      (field as HTMLElement).dataset.unit = unit;
      field.append(u);
    }
    if (typeof fallback !== 'number') return b; // reset only makes sense for numbers, not fonts, colors or toggles

    const noSlider = params.min === undefined || params.max === undefined;
    b.element.classList.add('has-reset');
    if (noSlider) b.element.classList.add('compact');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rst';
    btn.title = 'Reset to default';
    btn.setAttribute('aria-label', 'Reset to default');
    btn.innerHTML =
      '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8a5 5 0 1 0 1.6-3.7"/><path d="M3 2.5v3h3"/></svg>';
    const commit = () => {
      refreshing = true; // one redraw below instead of one per refreshed binding
      b.refresh();
      refreshing = false;
      widgets.forEach((w) => w.render());
      updateResets();
      hooks.onChange();
    };
    btn.addEventListener('click', () => {
      rec[key] = fallback;
      commit();
    });

    /* Scrub anywhere on a compact number field: click types, click-and-drag changes the value (shift = fine). */
    const input = b.element.querySelector<HTMLInputElement>('.tp-txtv_i');
    if (noSlider && input) {
      const step = Number((params as { step?: number }).step ?? 0.01);
      const decimals = Math.max(0, Math.ceil(-Math.log10(step)) + 1);
      let drag: { x: number; v: number; moved: boolean } | null = null;
      input.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || document.activeElement === input) return; // already typing: normal caret behaviour
        e.preventDefault();
        input.setPointerCapture(e.pointerId);
        drag = { x: e.clientX, v: Number(rec[key]), moved: false };
      });
      input.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        if (!drag.moved && Math.abs(dx) < 3) return;
        drag.moved = true;
        input.classList.add('scrubbing');
        rec[key] = Number((drag.v + dx * step * (e.shiftKey ? 0.1 : 1)).toFixed(decimals));
        commit();
      });
      const end = () => {
        if (!drag) return;
        const wasClick = !drag.moved;
        drag = null;
        input.classList.remove('scrubbing');
        if (wasClick) {
          input.focus();
          input.select();
        }
      };
      input.addEventListener('pointerup', end);
      input.addEventListener('pointercancel', end);
    }
    b.element.querySelector('.tp-lblv_v')?.appendChild(btn);

    const update = () => {
      const changed = !same(rec[key], fallback);
      btn.classList.toggle('on', changed);
      b.element.classList.toggle('is-default', !changed); // dims the value so edited fields stand out
    };
    resets.push(update);
    update();
    return b;
  }

  /* Icon segmented control (Figma-style) in place of a dropdown. The hidden list binding keeps
     Tweakpane's row layout and its refresh path, so undo, presets and loads update it like any field. */
  function segmented(folder: FolderApi, obj: object, key: string, items: { value: string; label: string; icon: string }[]) {
    const rec = obj as Record<string, unknown>;
    const b = folder.addBinding(rec, key, { options: Object.fromEntries(items.map((i) => [i.label, i.value])) });
    const group = document.createElement('div');
    group.className = 'seg';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', key);
    const btns = items.map((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.title = item.label;
      btn.setAttribute('aria-label', item.label);
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${item.icon}</svg>`;
      btn.addEventListener('click', () => {
        if (rec[key] === item.value) return;
        rec[key] = item.value;
        refreshing = true; // one redraw below instead of the pane's change event
        b.refresh();
        refreshing = false;
        sync();
        hooks.onChange();
      });
      group.append(btn);
      return btn;
    });
    // Arrow keys move the selection, like a native radio group; only the selected box is a tab stop.
    group.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      const i = items.findIndex((it) => it.value === rec[key]);
      const next = btns[(i + d + btns.length) % btns.length];
      next.click();
      next.focus();
    });
    const sync = () =>
      btns.forEach((btn, i) => {
        const on = items[i].value === rec[key];
        btn.setAttribute('aria-checked', String(on));
        btn.tabIndex = on ? 0 : -1;
      });
    b.element.querySelector('.tp-lblv_v')!.replaceChildren(group);
    b.on('change', sync);
    syncers.push(sync);
    sync();
    return b;
  }

  /* Type */
  const tf = pane.addFolder({ title: 'Type' });
  const tb = (key: string, params?: BindParams) => bindR(tf, state.type, defaults.type, key, params);
  const fontBinding = tb('font', {
    options: Object.fromEntries(Object.entries(FONTS).map(([id, f]) => [f.label, id])),
  });

  /* Weight: its options depend on the family, and Tweakpane lists can't change options, so the binding is rebuilt
     (in place, right under font) whenever the family changes, from the panel or from undo / presets / loading. */
  let weightBinding: { dispose(): void; refresh(): void } | null = null;
  let weightFamily = '';
  const syncWeight = () => {
    const id = state.type.font as FontId;
    state.type.weight = nearestWeight(id, state.type.weight);
    if (weightBinding && weightFamily === id) return weightBinding.refresh();
    weightBinding?.dispose();
    weightFamily = id;
    weightBinding = tf.addBinding(state.type, 'weight', {
      index: 1,
      options: Object.fromEntries(FONTS[id].weights.map((w) => [WEIGHT_NAMES[w] ?? String(w), w])),
    });
  };
  syncWeight();
  fontBinding.on('change', syncWeight);
  syncers.push(syncWeight);
  tb('textCase', {
    label: 'case',
    options: { 'As typed': 'as-typed', 'ALL CAPS': 'upper', 'Sentence case': 'sentence', lowercase: 'lower' },
  });
  tb('tracking', { step: 0.005 });
  tb('leading', { step: 0.005 });
  tb('leadingMode', { label: 'leading by', options: { 'Optical (ink)': 'optical', 'Metric (cap height)': 'metric' } });
  /* stretchX is stored as a width multiplier (1 = natural) but shown as a signed % offset (0 = natural). */
  const stretchView = (t: () => { stretchX: number }) => ({
    get stretchX() {
      return Math.round((t().stretchX - 1) * 100);
    },
    set stretchX(v: number) {
      t().stretchX = 1 + v / 100;
    },
  });
  bindR(tf, stretchView(() => state.type), stretchView(() => defaults.type), 'stretchX', {
    label: 'stretch x %',
    min: -60,
    max: 80,
    step: 1,
  });
  segmented(tf, state.type, 'align', [
    { value: 'left', label: 'Align left', icon: '<path d="M21 6H3"/><path d="M15 12H3"/><path d="M17 18H3"/>' },
    { value: 'center', label: 'Align center', icon: '<path d="M21 6H3"/><path d="M17 12H7"/><path d="M19 18H5"/>' },
    { value: 'right', label: 'Align right', icon: '<path d="M21 6H3"/><path d="M21 12H9"/><path d="M21 18H7"/>' },
  ]);
  tb('fit', { label: 'fit width', min: 0, max: 1, step: 0.01 });
  tb('stepRatio', { label: 'step ratio', min: 1, max: 2.5, step: 0.01 });

  /* Color */
  const cf = pane.addFolder({ title: 'Color' });
  for (const k of ['background', 'text', 'highlight']) bindR(cf, state.color, defaults.color, k);

  /* Effects (schema-driven) */
  const editFromWidget = () => {
    // refresh() fires a pane 'change' per updated binding; redraw once instead.
    refreshing = true;
    pane.refresh();
    refreshing = false;
    widgets.forEach((w) => w.render());
    updateResets();
    hooks.onChange();
  };

  for (const def of EFFECTS) {
    const p = state.effects[def.id as keyof EffectsState] as unknown as Record<string, unknown> & {
      enabled: boolean;
    };
    const controls = def.controls as Record<string, Control>;
    const primary = new Set<string>(def.primary as readonly string[]);
    const defP = defaults.effects[def.id as keyof EffectsState] as object;
    const bind = (folder: FolderApi, key: string) => {
      const { random: _r, ...params } = controls[key];
      return bindR(folder, p, defP, key, params);
    };

    const f = pane.addFolder({ title: def.label, expanded: p.enabled });
    // The on/off checkbox sits next to the section name, as a sibling of the title button so clicking it
    // doesn't also toggle the disclosure.
    const power = document.createElement('input');
    power.type = 'checkbox';
    power.className = 'fx-check';
    power.setAttribute('aria-label', `${def.label} on/off`);
    f.element.append(power);
    const rest: { disabled: boolean }[] = [
      bindR(f, p, defP, 'scope', { options: SCOPES }),
      bindR(f, p, defP, 'amount', { min: 0, max: AMOUNT_MAX, step: 0.01 }),
    ];

    const widget =
      def.id === 'envelope'
        ? envelopeWidget(state.effects.envelope, editFromWidget)
        : def.id === 'cloth'
          ? clothWidget(state.effects.cloth, editFromWidget)
          : null;
    if (widget) {
      // A separator blade keeps the widget in order inside the folder.
      const host = f.addBlade({ view: 'separator' });
      host.element.replaceChildren(widget.el);
      host.element.classList.add('wdg-host');
      widgets.push(widget);
      widget.render();
    }

    for (const key of Object.keys(controls)) if (primary.has(key)) rest.push(bind(f, key));
    if (def.id === 'jitter') {
      rest.push(
        f.addButton({ title: 'Shuffle' }).on('click', () => {
          state.effects.jitter.seed = 1 + Math.floor(Math.random() * 998);
          pane.refresh();
          updateResets();
          hooks.onChange();
        }),
      );
    }

    const secondary = Object.keys(controls).filter((k) => !primary.has(k));
    if (secondary.length) {
      // A quiet disclosure row (styled in CSS), not another section header.
      const details = f.addFolder({ title: 'Advanced', expanded: false });
      details.element.classList.add('adv');
      for (const key of secondary) rest.push(bind(details, key));
    }

    const sync = () => {
      rest.forEach((b) => (b.disabled = !p.enabled));
      power.checked = p.enabled;
      power.title = p.enabled ? 'On: click to turn off' : 'Off: click to turn on';
      f.element.classList.toggle('fx-off', !p.enabled);
    };
    power.addEventListener('change', () => {
      p.enabled = power.checked;
      sync();
      f.expanded = p.enabled;
      widgets.forEach((w) => w.render());
      hooks.onChange();
    });
    sync();
    syncers.push(() => {
      sync();
      f.expanded = p.enabled;
    });
  }

  /* Output */
  const of = pane.addFolder({ title: 'Output', expanded: false });
  bindR(of, state.output, defaults.output, 'padding', { min: 0, max: 0.5, step: 0.01 });
  bindR(of, state.type, defaults.type, 'detail', { label: 'curve step', min: 0.5, max: 6, step: 0.1 });

  pane.on('change', () => {
    updateResets();
    if (refreshing) return;
    widgets.forEach((w) => w.render());
    hooks.onChange();
  });

  return {
    refresh() {
      // pane.refresh() emits a 'change' per updated binding; callers redraw once themselves.
      refreshing = true;
      // Rebuild the weight list for the new family first: a list refreshed with a value it doesn't offer
      // (e.g. Outfit's list seeing DM Sans's 1000) resets itself to its first option and writes that back.
      syncWeight();
      pane.refresh();
      refreshing = false;
      syncers.forEach((s) => s());
      widgets.forEach((w) => w.render());
      updateResets();
    },
  };
}
