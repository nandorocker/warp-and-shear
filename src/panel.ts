import { Pane, type FolderApi } from 'tweakpane';
import { AMOUNT_MAX, EFFECTS, type Control, type EffectsState } from './core/effects';
import type { DesignState } from './core/render';
import { FONTS, PRESETS } from './state';
import { clothWidget } from './widgets/cloth';
import { envelopeWidget } from './widgets/envelope';

export interface PanelHooks {
  onChange(): void;
  onPreset(name: string, keepText: boolean): void;
  onResetEffects(): void;
  onSaveJson(): void;
  onLoadJson(): void;
}

const SCOPES = { Block: 'block', Line: 'line', Glyph: 'glyph' };

/** Builds the control panel. Effect sections are generated from each effect's control schema. */
export function buildPanel(container: HTMLElement, state: DesignState, hooks: PanelHooks) {
  const pane = new Pane({ container });
  const syncers: (() => void)[] = [];

  /* Presets */
  const pf = pane.addFolder({ title: 'Presets' });
  const presetPick = { preset: '', keepText: false };
  pf.addBinding(presetPick, 'preset', {
    options: { '—': '', ...Object.fromEntries(Object.keys(PRESETS).map((n) => [n, n])) },
  }).on('change', (ev) => {
    if (ev.value) hooks.onPreset(ev.value, presetPick.keepText);
  });
  pf.addBinding(presetPick, 'keepText', { label: 'keep text' });
  pf.addButton({ title: 'Reset effects' }).on('click', hooks.onResetEffects);
  pf.addButton({ title: 'Save settings (.json)' }).on('click', hooks.onSaveJson);
  pf.addButton({ title: 'Load settings (.json)' }).on('click', hooks.onLoadJson);

  /* Type */
  const tf = pane.addFolder({ title: 'Type' });
  tf.addBinding(state.type, 'font', {
    options: Object.fromEntries(Object.entries(FONTS).map(([id, f]) => [f.label, id])),
  });
  tf.addBinding(state.type, 'textCase', {
    label: 'case',
    options: { 'As typed': 'as-typed', 'ALL CAPS': 'upper', 'Sentence case': 'sentence', lowercase: 'lower' },
  });
  tf.addBinding(state.type, 'tracking', { min: -0.15, max: 0.3, step: 0.005 });
  tf.addBinding(state.type, 'leading', { min: -0.4, max: 1, step: 0.005 });
  tf.addBinding(state.type, 'leadingMode', { label: 'leading by', options: { 'Optical (ink)': 'optical', 'Metric (cap height)': 'metric' } });
  tf.addBinding(state.type, 'stretchX', { label: 'stretch x', min: 0.4, max: 1.8, step: 0.01 });
  tf.addBinding(state.type, 'align', { options: { Left: 'left', Center: 'center', Right: 'right' } });
  tf.addBinding(state.type, 'fit', { label: 'fit width', min: 0, max: 1, step: 0.01 });
  tf.addBinding(state.type, 'stepRatio', { label: 'step ratio', min: 1, max: 2.5, step: 0.01 });

  /* Color */
  const cf = pane.addFolder({ title: 'Color' });
  cf.addBinding(state.color, 'background');
  cf.addBinding(state.color, 'text');
  cf.addBinding(state.color, 'highlight');

  /* Effects (schema-driven) */
  const widgets: { render(): void }[] = [];
  let refreshing = false;
  const editFromWidget = () => {
    // refresh() fires a pane 'change' per updated binding; redraw once instead.
    refreshing = true;
    pane.refresh();
    refreshing = false;
    widgets.forEach((w) => w.render());
    hooks.onChange();
  };

  for (const def of EFFECTS) {
    const p = state.effects[def.id as keyof EffectsState] as unknown as Record<string, unknown> & {
      enabled: boolean;
    };
    const controls = def.controls as Record<string, Control>;
    const primary = new Set<string>(def.primary as readonly string[]);
    const bind = (folder: FolderApi, key: string) => {
      const { random: _r, ...params } = controls[key];
      return folder.addBinding(p, key, params);
    };

    const f = pane.addFolder({ title: def.label, expanded: p.enabled });
    const on = f.addBinding(p, 'enabled', { label: 'on' });
    const rest: { disabled: boolean }[] = [
      f.addBinding(p, 'scope', { options: SCOPES }),
      f.addBinding(p, 'amount', { min: 0, max: AMOUNT_MAX, step: 0.01 }),
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
          hooks.onChange();
        }),
      );
    }

    const secondary = Object.keys(controls).filter((k) => !primary.has(k));
    if (secondary.length) {
      const details = f.addFolder({ title: 'Details', expanded: false });
      for (const key of secondary) rest.push(bind(details, key));
    }

    const sync = () => rest.forEach((b) => (b.disabled = !p.enabled));
    on.on('change', () => {
      sync();
      if (p.enabled) f.expanded = true;
    });
    sync();
    syncers.push(() => {
      sync();
      if (p.enabled) f.expanded = true;
    });
  }

  /* Output */
  const of = pane.addFolder({ title: 'Output', expanded: false });
  of.addBinding(state.output, 'aspect', {
    label: 'frame',
    options: { 'Fit content': 'fit', '1:1': '1:1', '4:5': '4:5', '3:4': '3:4', '16:9': '16:9', '9:16': '9:16' },
  });
  of.addBinding(state.output, 'padding', { min: 0, max: 0.5, step: 0.01 });
  of.addBinding(state.output, 'transparent', { label: 'no bg on export' });
  of.addBinding(state.type, 'detail', { label: 'curve step', min: 0.5, max: 6, step: 0.1 });

  pane.on('change', () => {
    if (refreshing) return;
    widgets.forEach((w) => w.render());
    hooks.onChange();
  });

  return {
    refresh() {
      pane.refresh();
      syncers.forEach((s) => s());
      widgets.forEach((w) => w.render());
    },
  };
}
