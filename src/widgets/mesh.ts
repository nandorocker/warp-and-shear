import type { Frame, PointFn } from '../core/effects';

const NS = 'http://www.w3.org/2000/svg';

/** Virtual box the widgets warp (roughly a two-line text block). */
export const BOX = { w: 240, h: 110 };

export function frameFor(w = BOX.w, h = BOX.h): Frame {
  return { x0: 0, y0: 0, w, h, cx: w / 2, cy: h / 2, i: 0, n: 1 };
}

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const f2 = (n: number) => (Math.round(n * 10) / 10).toString();

/** Polyline through `fn` along a straight segment of the box (in unit coords). */
function warpedLine(fn: PointFn, f: Frame, u0: number, v0: number, u1: number, v1: number, samples: number): string {
  let d = '';
  for (let j = 0; j <= samples; j++) {
    const t = j / samples;
    const [x, y] = fn(f.x0 + (u0 + (u1 - u0) * t) * f.w, f.y0 + (v0 + (v1 - v0) * t) * f.h, f);
    d += (j ? 'L' : 'M') + f2(x) + ' ' + f2(y);
  }
  return d;
}

/** Grid lines and outline of the warped box, as two path `d` strings. */
export function warpedMesh(fn: PointFn, f: Frame, cols = 12, rows = 5, samples = 48) {
  let grid = '';
  for (let c = 1; c < cols; c++) grid += warpedLine(fn, f, c / cols, 0, c / cols, 1, 12);
  for (let r = 1; r < rows; r++) grid += warpedLine(fn, f, 0, r / rows, 1, r / rows, samples);
  const outline =
    warpedLine(fn, f, 0, 0, 1, 0, samples) +
    warpedLine(fn, f, 1, 0, 1, 1, 12).replace(/^M/, 'L') +
    warpedLine(fn, f, 1, 1, 0, 1, samples).replace(/^M/, 'L') +
    warpedLine(fn, f, 0, 1, 0, 0, 12).replace(/^M/, 'L') +
    'Z';
  return { grid, outline };
}

export interface DragInfo {
  /** Pointer movement since pointerdown, in CSS pixels. */
  dx: number;
  dy: number;
  /** Size of the dragged element, in CSS pixels. */
  width: number;
  height: number;
  event: PointerEvent;
}

/**
 * Pointer drag helper. `start` gets the pointerdown event and returns the
 * per-move handler, or null to ignore the press.
 */
export function onDrag(el: Element, start: (e: PointerEvent) => ((d: DragInfo) => void) | null, end?: () => void) {
  let active = false;
  el.addEventListener('pointerdown', (ev) => {
    const e = ev as PointerEvent;
    if (e.button !== 0 || active) return;
    const move = start(e);
    if (!move) return;
    active = true;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const x0 = e.clientX;
    const y0 = e.clientY;
    (el as HTMLElement).setPointerCapture?.(e.pointerId);
    el.classList.add('dragging');
    const onMove = (m: Event) => {
      const pm = m as PointerEvent;
      if (pm.pointerId !== e.pointerId) return;
      move({ dx: pm.clientX - x0, dy: pm.clientY - y0, width: rect.width, height: rect.height, event: pm });
    };
    const onUp = (u: Event) => {
      if ((u as PointerEvent).pointerId !== e.pointerId || !active) return;
      active = false;
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('lostpointercapture', onUp);
      el.classList.remove('dragging');
      end?.();
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('lostpointercapture', onUp);
  });
}

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Wrap degrees into [-180, 180). */
export const wrapDeg = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
