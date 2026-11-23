import { Pane } from 'tweakpane';
import { EFFECTS, type Control, type EffectsState } from './core/effects';
import type { DesignState } from './core/render';
import { FONTS, PRESETS } from './state';

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
  for (const def of EFFECTS) {
    const p = state.effects[def.id as keyof EffectsState] as unknown as Record<string, unknown> & {
      enabled: boolean;
    };
    const f = pane.addFolder({ title: def.label, expanded: p.enabled });
    const on = f.addBinding(p, 'enabled', { label: 'on' });
    const rest = [f.addBinding(p, 'scope', { options: SCOPES })];
    for (const [key, c] of Object.entries(def.controls as Record<string, Control>)) {
      const { random: _r, ...params } = c;
      rest.push(f.addBinding(p, key, params));
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

  pane.on('change', () => hooks.onChange());

  return {
    refresh() {
      pane.refresh();
      syncers.forEach((s) => s());
    },
  };
}
