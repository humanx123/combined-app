// The Vibe wordmark, drawn as stroked centerlines so the weight is one number and every
// letter can be styled, moved, or animated on its own. Units: cap height 100, baseline at
// y = 100, y down. `npm run brand` writes the static SVGs in public/brand from this file.

/** Stroke weight of the letters. */
export const WEIGHT = 14;
/** Height of i, b's bowl, and e. */
const X_HEIGHT = 66;
/** How far round letters dip past the baseline and x-height so they look the same size. */
const OVERSHOOT = 2;
/** Diagonals look heavier than verticals, so the V is drawn a little lighter. */
const V_WEIGHT = WEIGHT * 0.94;
/** The V's point sits a little past the baseline for the same reason. */
const V_OVERSHOOT = 3;

export type Dot = { cx: number; cy: number; r: number };
export type Glyph = { d: string; width: number; weight: number; join: 'miter' | 'round'; dot?: Dot };
export type GlyphName = 'V' | 'i' | 'b' | 'e';

const n = (v: number) => +v.toFixed(2);
const pt = (x: number, y: number) => `${n(x)} ${n(y)}`;

/** Round-capped V whose mitered point lands at 100 + V_OVERSHOOT. Returns the y of the joint. */
function vJoint(weight: number, width: number) {
  const top = weight / 2, half = width / 2 - weight / 2;
  let lo = top + 1, hi = 100;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    const tip = mid + weight / 2 / Math.sin(Math.atan(half / (mid - top)));
    if (tip > 100 + V_OVERSHOOT) hi = mid; else lo = mid;
  }
  return lo;
}

function V(weight: number, width: number): Glyph {
  return { d: `M${pt(weight / 2, weight / 2)}L${pt(width / 2, vJoint(weight, width))}L${pt(width - weight / 2, weight / 2)}`, width, weight, join: 'miter' };
}

const bowlRadius = (X_HEIGHT + 2 * OVERSHOOT - WEIGHT) / 2;
const bowlY = 100 - X_HEIGHT / 2;

function i(): Glyph {
  const r = WEIGHT * 0.66;
  return { d: `M${pt(WEIGHT / 2, 100 - X_HEIGHT + WEIGHT / 2)}V${n(100 - WEIGHT / 2)}`, width: WEIGHT, weight: WEIGHT, join: 'round', dot: { cx: WEIGHT / 2, cy: r, r: n(r) } };
}

function b(): Glyph {
  const R = bowlRadius, cx = WEIGHT / 2 + R;
  return {
    d: `M${pt(WEIGHT / 2, WEIGHT / 2)}V${n(bowlY)}M${pt(cx - R, bowlY)}A${n(R)} ${n(R)} 0 1 1 ${pt(cx + R, bowlY)}A${n(R)} ${n(R)} 0 1 1 ${pt(cx - R, bowlY)}Z`,
    width: 2 * R + WEIGHT, weight: WEIGHT, join: 'round',
  };
}

/** Crossbar on the center line, then the bowl, ending in an open terminal 52° below it. */
function e(): Glyph {
  const R = bowlRadius, cx = WEIGHT / 2 + R, t = (52 * Math.PI) / 180;
  return {
    d: `M${pt(cx - R, bowlY)}H${n(cx + R)}A${n(R)} ${n(R)} 0 1 0 ${pt(cx + R * Math.cos(t), bowlY + R * Math.sin(t))}`,
    width: 2 * R + WEIGHT, weight: WEIGHT, join: 'round',
  };
}

export const GLYPHS: Record<GlyphName, Glyph> = { V: V(V_WEIGHT, 82), i: i(), b: b(), e: e() };

/** Where each letter starts. The gaps are the spacing between letters, tuned by eye. */
export const WORDMARK = (() => {
  const order: GlyphName[] = ['V', 'i', 'b', 'e'];
  const gaps = [9, 12, 8];
  let x = 0;
  const letters = order.map((name, k) => { const at = x; x += GLYPHS[name].width + (gaps[k] ?? 0); return { name, x: n(at) }; });
  return { letters, width: n(x), height: 100 + V_OVERSHOOT };
})();

/** The mark: the V holding the dot, a figure with its arms up. Heavier so it holds up as a favicon. */
export const MARK = (() => {
  const weight = 18, width = 86, gap = weight * 0.42;
  const glyph = V(weight, width);
  const top = weight / 2, joint = vJoint(weight, width);
  // Distance from a point on the center line to the left arm's center line.
  const ax = weight / 2, ay = top, bx = width / 2, by = joint;
  const len = Math.hypot(bx - ax, by - ay);
  const radiusAt = (cy: number) => Math.abs((bx - ax) * (ay - cy) - (ax - width / 2) * (by - ay)) / len - weight / 2 - gap;
  // The largest dot that keeps `gap` from both arms with its top a little below the arms' tops.
  const headroom = weight * 0.3;
  let lo = 0, hi = joint;
  for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (mid - radiusAt(mid) < headroom) lo = mid; else hi = mid; }
  const dot: Dot = { cx: width / 2, cy: n(hi), r: n(radiusAt(hi)) };
  return { glyph, dot, width, height: 100 + V_OVERSHOOT };
})();

/** The brand gradient, left to right: the agent's lilac into a warm amber. */
export const GRADIENT = ['#b69cff', '#ff8fcf', '#ffb547'] as const;
