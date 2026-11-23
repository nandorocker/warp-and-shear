import { cloth, effectiveParams, type ClothParams } from '../core/effects';
import { BOX, clamp, frameFor, onDrag, svgEl, warpedMesh, wrapDeg } from './mesh';

const LENSES = [
  { label: 'Flat', value: 0 },
  { label: 'Normal', value: 0.3 },
  { label: 'Wide', value: 0.6 },
  { label: 'Ultra', value: 1 },
];
const VIEW = { x: -60, y: -55, w: 360, h: 220 };
const STRIP = { w: BOX.w, h: 64 };
/** Strip px per unit of depth (Z amplitude = depth × 0.25 × width). */
const STRIP_SCALE = 0.3;

/**
 * Cloth widget: a live 3D mesh you orbit by dragging, a wave strip for depth
 * and phase, and lens chips for perspective.
 */
export function clothWidget(p: ClothParams, onEdit: () => void) {
  const el = document.createElement('div');
  el.className = 'wdg';

  const stage = svgEl('svg', { viewBox: `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`, class: 'wdg-stage wdg-orbit' });
  const grid = svgEl('path', { class: 'wdg-grid' });
  const outline = svgEl('path', { class: 'wdg-outline' });
  stage.append(grid, outline);

  const hint = document.createElement('div');
  hint.className = 'wdg-hint';
  hint.textContent = 'Drag to turn and tilt. Double-click to face front.';

  const strip = svgEl('svg', {
    viewBox: `0 ${-STRIP.h / 2} ${STRIP.w} ${STRIP.h}`,
    class: 'wdg-strip',
    preserveAspectRatio: 'none',
  });
  const axis = svgEl('line', { x1: 0, y1: 0, x2: STRIP.w, y2: 0, class: 'wdg-axis' });
  const wave = svgEl('path', { class: 'wdg-wave' });
  strip.append(axis, wave);

  const hint2 = document.createElement('div');
  hint2.className = 'wdg-hint';
  hint2.textContent = 'Wave: drag up/down for depth, sideways to slide it.';

  const chips = document.createElement('div');
  chips.className = 'wdg-chips';
  const chipEls = LENSES.map((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = l.label;
    b.title = `Perspective ${l.value}`;
    b.addEventListener('click', () => {
      p.perspective = l.value;
      onEdit();
    });
    chips.append(b);
    return { b, value: l.value };
  });
  const lensLabel = document.createElement('span');
  lensLabel.className = 'wdg-chips-label';
  lensLabel.textContent = 'Lens';
  chips.prepend(lensLabel);

  el.append(stage, hint, strip, hint2, chips);

  const f = frameFor();

  onDrag(stage, () => {
    // At Amount 0 turn/tilt have no visible effect, so don't edit them blind.
    if (!p.enabled || p.amount <= 0.01) return null;
    const amt = Math.max(p.amount, 0.2);
    const t0 = p.turn;
    const tl0 = p.tilt;
    return ({ dx, dy, width, height }) => {
      p.turn = Math.round(clamp(t0 + ((dx / width) * 150) / amt, -75, 75) * 2) / 2;
      p.tilt = Math.round(clamp(tl0 - ((dy / height) * 120) / amt, -60, 60) * 2) / 2;
      onEdit();
    };
  });
  stage.addEventListener('dblclick', () => {
    if (!p.enabled) return;
    p.turn = 0;
    p.tilt = 0;
    onEdit();
  });

  onDrag(strip, (e) => {
    if (!p.enabled) return null;
    const rect = strip.getBoundingClientRect();
    const u = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const g = Math.sin(2 * Math.PI * p.waves * u + (p.phase * Math.PI) / 180);
    const sign = Math.abs(g) < 0.2 ? 1 : Math.sign(g);
    const live = p.amount > 0.01;
    const amt = Math.max(p.amount, 0.2);
    const d0 = p.depth;
    const ph0 = p.phase;
    return ({ dx, dy, width, height }) => {
      const dyView = (dy / height) * STRIP.h;
      if (live) p.depth = Math.round(clamp(d0 - (sign * dyView) / (0.25 * BOX.w * STRIP_SCALE) / amt, 0, 1.5) * 100) / 100;
      p.phase = Math.round(wrapDeg(ph0 - (360 * p.waves * dx) / width));
      onEdit();
    };
  });

  function render() {
    el.classList.toggle('off', !p.enabled);
    const eff = effectiveParams(cloth, p);
    const m = warpedMesh(cloth.make(eff), f);
    grid.setAttribute('d', m.grid);
    outline.setAttribute('d', m.outline);

    // Depth profile along the text (what the Z ripple looks like from above).
    let d = '';
    const k = 2 * Math.PI * p.waves;
    const ph = (p.phase * Math.PI) / 180;
    for (let j = 0; j <= 96; j++) {
      const u = j / 96;
      const amp = eff.depth * 0.25 * BOX.w * (1 - p.pole + p.pole * u);
      const z = amp * Math.sin(k * u + ph);
      d += (j ? 'L' : 'M') + (u * STRIP.w).toFixed(1) + ' ' + (-z * STRIP_SCALE).toFixed(1);
    }
    wave.setAttribute('d', d);

    let best = chipEls[0];
    for (const c of chipEls) if (Math.abs(c.value - p.perspective) < Math.abs(best.value - p.perspective)) best = c;
    for (const c of chipEls) c.b.classList.toggle('active', c === best && Math.abs(c.value - p.perspective) < 0.08);
  }

  return { el, render };
}
