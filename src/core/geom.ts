/** Flat point list: [x0, y0, x1, y1, ...] */
export type Pts = number[];

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const DEG = Math.PI / 180;

export function emptyBox(): Box {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

export function growBox(b: Box, pts: Pts): Box {
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i];
    const y = pts[i + 1];
    if (x < b.x0) b.x0 = x;
    if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y;
    if (y > b.y1) b.y1 = y;
  }
  return b;
}

export function isEmptyBox(b: Box): boolean {
  return !(b.x1 >= b.x0 && b.y1 >= b.y0);
}

/** Minimal shape of opentype.js path commands. */
export type PathCmd =
  | { type: 'M' | 'L'; x: number; y: number }
  | { type: 'Q'; x1: number; y1: number; x: number; y: number }
  | { type: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: 'Z' };

/**
 * Converts path commands into closed polylines whose segments are at most
 * `seg` long. Straight edges are subdivided too: a non-linear warp has to be
 * able to bend the stem of an "E".
 */
export function flattenPath(cmds: readonly PathCmd[], seg: number): Pts[] {
  const out: Pts[] = [];
  let cur: Pts | null = null;
  let px = 0;
  let py = 0;
  let sx = 0;
  let sy = 0;

  const steps = (len: number) => Math.min(96, Math.max(1, Math.ceil(len / seg)));

  const lineTo = (x: number, y: number, includeEnd: boolean) => {
    const n = steps(Math.hypot(x - px, y - py));
    const last = includeEnd ? n : n - 1;
    for (let j = 1; j <= last; j++) {
      const t = j / n;
      cur!.push(px + (x - px) * t, py + (y - py) * t);
    }
  };

  const finish = () => {
    if (!cur) return;
    const n = cur.length;
    if (n >= 4 && Math.abs(cur[0] - cur[n - 2]) < 1e-9 && Math.abs(cur[1] - cur[n - 1]) < 1e-9) {
      cur.length = n - 2;
    }
    if (cur.length >= 6) out.push(cur);
    cur = null;
  };

  for (const c of cmds) {
    switch (c.type) {
      case 'M':
        finish();
        cur = [c.x, c.y];
        px = sx = c.x;
        py = sy = c.y;
        break;
      case 'L':
        if (!cur) cur = [px, py];
        lineTo(c.x, c.y, true);
        px = c.x;
        py = c.y;
        break;
      case 'Q': {
        if (!cur) cur = [px, py];
        const n = steps(Math.hypot(c.x1 - px, c.y1 - py) + Math.hypot(c.x - c.x1, c.y - c.y1));
        for (let j = 1; j <= n; j++) {
          const t = j / n;
          const mt = 1 - t;
          cur.push(
            mt * mt * px + 2 * mt * t * c.x1 + t * t * c.x,
            mt * mt * py + 2 * mt * t * c.y1 + t * t * c.y,
          );
        }
        px = c.x;
        py = c.y;
        break;
      }
      case 'C': {
        if (!cur) cur = [px, py];
        const n = steps(
          Math.hypot(c.x1 - px, c.y1 - py) +
            Math.hypot(c.x2 - c.x1, c.y2 - c.y1) +
            Math.hypot(c.x - c.x2, c.y - c.y2),
        );
        for (let j = 1; j <= n; j++) {
          const t = j / n;
          const mt = 1 - t;
          const a = mt * mt * mt;
          const b = 3 * mt * mt * t;
          const d = 3 * mt * t * t;
          const e = t * t * t;
          cur.push(
            a * px + b * c.x1 + d * c.x2 + e * c.x,
            a * py + b * c.y1 + d * c.y2 + e * c.y,
          );
        }
        px = c.x;
        py = c.y;
        break;
      }
      case 'Z':
        if (cur && (px !== sx || py !== sy)) lineTo(sx, sy, false);
        finish();
        px = sx;
        py = sy;
        break;
    }
  }
  finish();
  return out;
}

/** Rectangle outline sampled along its edges, so warps can bend it. */
export function sampledRect(x0: number, y0: number, x1: number, y1: number, perEdge = 6): Pts {
  const pts: Pts = [];
  const edge = (ax: number, ay: number, bx: number, by: number) => {
    for (let i = 0; i < perEdge; i++) {
      const t = i / perEdge;
      pts.push(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  };
  edge(x0, y0, x1, y0);
  edge(x1, y0, x1, y1);
  edge(x1, y1, x0, y1);
  edge(x0, y1, x0, y0);
  return pts;
}

/**
 * Projective map from the unit square onto a quad (Heckbert).
 * Corners: p0=(0,0) p1=(1,0) p2=(1,1) p3=(0,1).
 */
export function squareToQuad(q: readonly [number, number][]): (u: number, v: number) => [number, number] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const det = dx1 * dy2 - dx2 * dy1 || 1e-12;
  const g = (dx3 * dy2 - dx2 * dy3) / det;
  const h = (dx1 * dy3 - dx3 * dy1) / det;
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  return (u, v) => {
    let w = g * u + h * v + 1;
    if (Math.abs(w) < 1e-3) w = w < 0 ? -1e-3 : 1e-3;
    return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w];
  };
}

/** Deterministic hash → [0, 1). Same (seed, i, k) always gives the same value. */
export function rand(seed: number, i: number, k: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b);
  h ^= Math.imul(i + 1, 0xc2b2ae35);
  h ^= Math.imul(k + 7, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
