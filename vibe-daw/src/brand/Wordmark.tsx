import { useEffect, useId, useState, type CSSProperties } from 'react';
import { GLYPHS, GRADIENT, MARK, WORDMARK, type Dot, type Glyph, type GlyphName } from './glyphs';
import './brand.css';

/** `gradient` is the brand look. `mono` takes the text color, with the dot in the agent's lilac. */
type Tone = 'gradient' | 'mono';

const stops = GRADIENT.map((color, k) => <stop key={color} offset={k / (GRADIENT.length - 1)} stopColor={color} />);
// useId can contain characters that url(#…) would need escaped.
const useSvgId = () => `vibe${useId().replace(/[^\w-]/g, '')}`;
/** Slides a gradient across `span` and back over 2 × `seconds`, like the CSS color flow. */
function Flow({ span, seconds }: { span: number; seconds: number }) {
  // Read after mount, so a prerendered landing page hydrates with the same tree.
  const [reduced, setReduced] = useState(false);
  useEffect(() => { setReduced(matchMedia('(prefers-reduced-motion: reduce)').matches); }, []);
  if (!seconds || reduced) return null;
  return <animateTransform attributeName="gradientTransform" type="translate" values={`0 0;${span} 0;0 0`} keyTimes="0;0.5;1" calcMode="spline" keySplines="0.42 0 0.58 1;0.42 0 0.58 1" dur={`${seconds * 2}s`} repeatCount="indefinite" />;
}
// An empty label hides the drawing from assistive tech, for when a parent already names it.
const named = (label: string) => label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };

// A slight raise, like the buttons: a soft sheen down each letter (lighter on top, a touch
// darker below) and a thin lip underneath. `sheen` is a vertical gradient in the letters' space.
const sheenStops = [<stop key="0" offset="0" stopColor="#fff" stopOpacity="0.2" />, <stop key="1" offset="0.48" stopColor="#fff" stopOpacity="0.04" />, <stop key="2" offset="0.56" stopColor="#000" stopOpacity="0" />, <stop key="3" offset="1" stopColor="#000" stopOpacity="0.14" />];

function Stroke({ glyph, paint, sheen }: { glyph: Glyph; paint: string; sheen: string }) {
  const line = { d: glyph.d, strokeWidth: glyph.weight, strokeLinejoin: glyph.join };
  return (
    <>
      <g transform={`translate(0 ${glyph.weight * 0.07})`}><path {...line} style={{ stroke: paint }} /><path {...line} style={{ stroke: 'rgba(0, 0, 0, 0.4)' }} /></g>
      <path {...line} style={{ stroke: paint }} />
      <path {...line} style={{ stroke: sheen }} />
    </>
  );
}

function DotMark({ dot, tone, sheen, className = 'vibe-dot' }: { dot: Dot; tone: Tone; sheen: string; className?: string }) {
  const fill = `var(--vibe-dot, ${tone === 'gradient' ? 'var(--logo-dot, #fff)' : 'var(--agent, #b69cff)'})`;
  const { cx, cy, r } = dot;
  return (
    <g className={className || undefined}>
      <circle cx={cx} cy={cy + r * 0.1} r={r} style={{ fill }} /><circle cx={cx} cy={cy + r * 0.1} r={r} fill="rgba(0, 0, 0, 0.35)" />
      <circle cx={cx} cy={cy} r={r} style={{ fill }} />
      <circle cx={cx} cy={cy} r={r} style={{ fill: sheen }} />
    </g>
  );
}

/**
 * The Vibe wordmark. Each letter is its own group (`.vibe-v`, `.vibe-i`, `.vibe-b`, `.vibe-e`)
 * so it can be animated alone, and its own color variable (`--vibe-v` and so on, plus
 * `--vibe-dot`) so it can be restyled alone. Letter positions live in glyphs.ts.
 */
export function Wordmark({ tone = 'gradient', className = '', label = 'Vibe', style, glow = false, flow = 0 }: { tone?: Tone; className?: string; label?: string; style?: CSSProperties; glow?: boolean; flow?: number }) {
  const id = useSvgId();
  return (
    <svg className={`vibe-wordmark ${className}`} viewBox={`-2 -2 ${WORDMARK.width + 4} ${WORDMARK.height + 4}`} {...named(label)} style={style}>
      <defs>
        {tone === 'gradient' && WORDMARK.letters.map(({ name, x }) => (
          // One gradient spans the word; each letter gets it shifted to its own origin.
          <linearGradient key={name} id={`${id}-${name}`} gradientUnits="userSpaceOnUse" spreadMethod="reflect" x1={-x} y1={0} x2={WORDMARK.width - x} y2={0}>{stops}<Flow span={WORDMARK.width} seconds={flow} /></linearGradient>
        ))}
        <linearGradient id={`${id}-sheen`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={WORDMARK.height}>{sheenStops}</linearGradient>
        <linearGradient id={`${id}-sheen-dot`} x1={0} y1={0} x2={0} y2={1}>{sheenStops}</linearGradient>
        {/* A soft glow made of the letters themselves, blurred, so it carries their gradient. */}
        {glow && <filter id={`${id}-glow`} x="-15%" y="-35%" width="130%" height="170%">
          <feGaussianBlur stdDeviation="9" /><feComponentTransfer><feFuncA type="linear" slope="0.2" /></feComponentTransfer>
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>}
      </defs>
      <g filter={glow ? `url(#${id}-glow)` : undefined}>
      {WORDMARK.letters.map(({ name, x }, k) => {
        const glyph = GLYPHS[name], key = name.toLowerCase();
        return (
          <g key={name} transform={`translate(${x} 0)`}>
            <g className={`vibe-letter vibe-${key}`} style={{ '--i': k } as CSSProperties}>
              <Stroke glyph={glyph} paint={`var(--vibe-${key}, ${tone === 'gradient' ? `url(#${id}-${name})` : 'currentColor'})`} sheen={`url(#${id}-sheen)`} />
              {glyph.dot && <DotMark dot={glyph.dot} tone={tone} sheen={`url(#${id}-sheen-dot)`} />}
            </g>
          </g>
        );
      })}
      </g>
    </svg>
  );
}

/** The mark: the V holding the dot. For favicons, avatars, and anywhere the word won't fit. */
export function VibeMark({ tone = 'gradient', className = '', label = 'Vibe', flow = 0 }: { tone?: Tone; className?: string; label?: string; flow?: number }) {
  const id = useSvgId();
  return (
    <svg className={`vibe-mark ${className}`} viewBox={`-4 -4 ${MARK.width + 8} ${MARK.height + 8}`} {...named(label)}>
      <defs>
        {tone === 'gradient' && <linearGradient id={id} gradientUnits="userSpaceOnUse" spreadMethod="reflect" x1={0} y1={0} x2={MARK.width} y2={MARK.height}>{stops}<Flow span={MARK.width} seconds={flow} /></linearGradient>}
        <linearGradient id={`${id}-sheen`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={MARK.height}>{sheenStops}</linearGradient>
        <linearGradient id={`${id}-sheen-dot`} x1={0} y1={0} x2={0} y2={1}>{sheenStops}</linearGradient>
      </defs>
      <Stroke glyph={MARK.glyph} paint={`var(--vibe-v, ${tone === 'gradient' ? `url(#${id})` : 'currentColor'})`} sheen={`url(#${id}-sheen)`} />
      <DotMark dot={MARK.dot} tone={tone} sheen={`url(#${id}-sheen-dot)`} />
    </svg>
  );
}

type Box = { x0: number; y0: number; x1: number; y1: number };
const grow = (b: Box, x: number, y: number) => { b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); };
const emptyBox = (): Box => ({ x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

/** The geometry box of a glyph path (no stroke), as SVG's fill-box sees it. Handles the M L H V A Z the glyphs use. */
function pathBox(d: string, box = emptyBox(), dy = 0) {
  const tokens = d.match(/[MLHVAZ]|-?[\d.]+/g) ?? [];
  let cmd = '', x = 0, y = 0, start = [0, 0], k = 0;
  const num = () => +tokens[k++]!;
  while (k < tokens.length) {
    if (/[MLHVAZ]/.test(tokens[k]!)) cmd = tokens[k++]!;
    if (cmd === 'M' || cmd === 'L') { x = num(); y = num(); if (cmd === 'M') start = [x, y]; }
    else if (cmd === 'H') x = num();
    else if (cmd === 'V') y = num();
    else if (cmd === 'Z') { [x, y] = start as [number, number]; }
    else if (cmd === 'A') {
      // Endpoint to center parameterization (SVG 1.1 F.6.5), then sample the sweep.
      const rx = num(), ry = num(); num(); const large = num(), sweep = num(), ex = num(), ey = num();
      const hx = (x - ex) / 2, hy = (y - ey) / 2;
      const s = Math.sqrt(Math.max(0, (rx * rx * ry * ry - rx * rx * hy * hy - ry * ry * hx * hx) / (rx * rx * hy * hy + ry * ry * hx * hx))) * (large === sweep ? -1 : 1);
      const cx = s * rx * hy / ry + (x + ex) / 2, cy = -s * ry * hx / rx + (y + ey) / 2;
      const a0 = Math.atan2((y - cy) / ry, (x - cx) / rx);
      let da = Math.atan2((ey - cy) / ry, (ex - cx) / rx) - a0;
      if (sweep && da < 0) da += 2 * Math.PI;
      if (!sweep && da > 0) da -= 2 * Math.PI;
      for (let t = 0; t <= 720; t++) grow(box, cx + rx * Math.cos(a0 + da * t / 720), cy + ry * Math.sin(a0 + da * t / 720) + dy);
      x = ex; y = ey;
    }
    if (cmd !== 'Z') grow(box, x, y + dy);
  }
  return box;
}

const dotBox = ({ cx, cy, r }: Dot): Box => ({ x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r * 1.1 });
// Each letter's box as its group's fill-box: the face, the lip under it, and the dot.
const LETTER_BOXES = Object.fromEntries(WORDMARK.letters.map(({ name }) => {
  const glyph = GLYPHS[name], box = pathBox(glyph.d);
  pathBox(glyph.d, box, glyph.weight * 0.07);
  if (glyph.dot) { const d = dotBox(glyph.dot); grow(box, d.x0, d.y0); grow(box, d.x1, d.y1); }
  return [name, box];
})) as Record<GlyphName, Box>;
const pct = (v: number) => `${+(v * 100).toFixed(4)}%`;
const place = (b: Box, within: Box): CSSProperties => {
  const w = within.x1 - within.x0, h = within.y1 - within.y0;
  return { left: pct((b.x0 - within.x0) / w), top: pct((b.y0 - within.y0) / h), width: pct((b.x1 - b.x0) / w), height: pct((b.y1 - b.y0) / h) };
};
const viewBox = (b: Box) => `${b.x0} ${b.y0} ${b.x1 - b.x0} ${b.y1 - b.y0}`;

/**
 * The gradient wordmark with its glow, for animating. It looks the same as `<Wordmark glow />`,
 * but each letter (and the i's dot) is its own layer: a box the size of that letter's fill-box,
 * so CSS percentages and origins on `.vibe-letter` and `.vibe-dot` mean what they mean in the SVG,
 * and moving a letter is compositing alone instead of repainting and reblurring the whole word.
 * The glow is a second set of the same layers underneath, marked `.vibe-glow`.
 */
export function LayeredWordmark({ className = '', label = 'Vibe', flow = 0 }: { className?: string; label?: string; flow?: number }) {
  const id = useSvgId();
  const word: Box = { x0: -2, y0: -2, x1: WORDMARK.width + 2, y1: WORDMARK.height + 2 };
  const layer = (glow: boolean) => WORDMARK.letters.map(({ name, x }, k) => {
    const glyph = GLYPHS[name], key = name.toLowerCase(), box = LETTER_BOXES[name], sid = `${id}-${glow ? 'g' : 'f'}${k}`;
    const paint = `var(--vibe-${key}, url(#${sid}-ink))`;
    const defs = (b: Box) => <defs>
      <linearGradient id={`${sid}-ink`} gradientUnits="userSpaceOnUse" spreadMethod="reflect" x1={-x} y1={0} x2={WORDMARK.width - x} y2={0}>{stops}<Flow span={WORDMARK.width} seconds={flow} /></linearGradient>
      <linearGradient id={`${sid}-sheen`} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={0} y2={WORDMARK.height}>{sheenStops}</linearGradient>
      <linearGradient id={`${sid}-sheen-dot`} x1={0} y1={0} x2={0} y2={1}>{sheenStops}</linearGradient>
      {glow && <filter id={`${sid}-glow`} filterUnits="userSpaceOnUse" x={b.x0 - 40} y={b.y0 - 40} width={b.x1 - b.x0 + 80} height={b.y1 - b.y0 + 80}><feGaussianBlur stdDeviation="9" /><feComponentTransfer><feFuncA type="linear" slope="0.2" /></feComponentTransfer></filter>}
    </defs>;
    // The glow's region is wide enough for three deviations of blur on every side.
    const dot = glyph.dot && dotBox(glyph.dot);
    return (
      <span key={name} className={`vibe-letter vibe-${key}${glow ? ' vibe-glow' : ''}`} data-letter={key} style={{ '--i': k, ...place({ x0: box.x0 + x, y0: box.y0, x1: box.x1 + x, y1: box.y1 }, word) } as CSSProperties}>
        <svg viewBox={viewBox(box)}>{defs(box)}<g filter={glow ? `url(#${sid}-glow)` : undefined}><Stroke glyph={glyph} paint={paint} sheen={`url(#${sid}-sheen)`} /></g></svg>
        {glyph.dot && dot && <span className="vibe-dot" style={place(dot, box)}>
          <svg viewBox={viewBox(dot)}>{defs(dot)}<g filter={glow ? `url(#${sid}-glow)` : undefined}><DotMark dot={glyph.dot} tone="gradient" sheen={`url(#${sid}-sheen-dot)`} className="" /></g></svg>
        </span>}
      </span>
    );
  });
  return (
    <div className={`vibe-wordmark vibe-layered ${className}`} {...named(label)} style={{ aspectRatio: `${word.x1 - word.x0} / ${word.y1 - word.y0}`, '--vibe-units': word.x1 - word.x0 } as CSSProperties}>
      {layer(true)}
      {layer(false)}
    </div>
  );
}
