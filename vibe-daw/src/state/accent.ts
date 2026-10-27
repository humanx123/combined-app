import { GRADIENT } from '../brand/glyphs';

// An accent is the agent's ink. It is stored as one of:
//   'vibe'                  the brand gradient (the default)
//   '#rrggbb'               one color
//   'g:#rrggbb,#rrggbb,...' a gradient of 2 to MAX_STOPS colors, left to right
// Filled surfaces paint the whole gradient; lines and text use its middle color.

export const VIBE_ACCENT = 'vibe';
export const MAX_STOPS = 4;
const HEX = '#[0-9a-f]{6}';
const VALID = new RegExp(`^(${HEX}|g:${HEX}(,${HEX}){1,${MAX_STOPS - 1}})$`);
/** The lilac that was the default before the gradient. Saved copies of it become the gradient. */
const OLD_DEFAULT = '#b69cff';

export const GRADIENT_PRESETS = [
  { name: 'Vibe', accent: VIBE_ACCENT },
  { name: 'Aurora', accent: 'g:#3ddc97,#5cc8ff,#b69cff' },
  { name: 'Sunset', accent: 'g:#ffb547,#ff6f91,#c86bfa' },
  { name: 'Ocean', accent: 'g:#5cc8ff,#6e7bff' },
  { name: 'Candy', accent: 'g:#ff9ad5,#a5b4ff' },
  { name: 'Citrus', accent: 'g:#c6f36b,#ffd166' },
  { name: 'Ember', accent: 'g:#ff5d73,#ffb547' },
];
export const SOLID_PRESETS = ['#5cc8ff', '#3ddc97', '#ffb547', '#ff7aa2', '#f7a8ff'];

/** A stored or synced accent, or the default if it is anything else. Never passes through CSS. */
export function sanitizeAccent(value: unknown): string {
  if (typeof value !== 'string') return VIBE_ACCENT;
  let accent = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(accent)) accent = `#${[...accent.slice(1)].map((c) => c + c).join('')}`;
  return VALID.test(accent) && accent !== OLD_DEFAULT ? accent : VIBE_ACCENT;
}

export const accentStops = (accent: string): string[] =>
  accent === VIBE_ACCENT ? [...GRADIENT] : accent.startsWith('g:') ? accent.slice(2).split(',') : [accent];

export function stopsToAccent(stops: string[]): string {
  const colors = stops.slice(0, MAX_STOPS).map((c) => c.toLowerCase());
  if (colors.join() === GRADIENT.join()) return VIBE_ACCENT;
  return colors.length === 1 ? colors[0] : `g:${colors.join(',')}`;
}

type Rgb = [number, number, number];
const toRgb = (hex: string): Rgb => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (rgb: Rgb) => `#${rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`;

/** The color a fraction `t` (0 to 1) of the way along the gradient. */
export function colorAt(stops: string[], t: number): string {
  if (stops.length === 1) return stops[0];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1), k = Math.min(Math.floor(x), stops.length - 2), f = x - k;
  const a = toRgb(stops[k]), b = toRgb(stops[k + 1]);
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * f) as Rgb);
}

const lighten = (hex: string) => toHex(toRgb(hex).map((c) => c + 25) as Rgb);
const gradient = (stops: string[]) => `linear-gradient(100deg, ${(stops.length === 1 ? [stops[0], stops[0]] : stops).join(', ')})`;

/** The solid color an accent uses where a gradient can't go: outlines, text, sliders. */
export const accentSolid = (accent: string) => colorAt(accentStops(accent), 0.5);
/** The paint for a filled surface. Always an image, so it also works as background-image. */
export const accentFill = (accent: string) => gradient(accentStops(accent));
export const accentFillStrong = (accent: string) => gradient(accentStops(accent).map(lighten));
/** The gradient there and back, twice as wide, so a surface can drift along it and loop smoothly. */
export function accentFlow(accent: string): string {
  const stops = accentStops(accent);
  return stops.length === 1 ? gradient(stops) : gradient([...stops, ...stops.slice(0, -1).reverse()]);
}
export const lightenColor = lighten;
export const rgbOf = toRgb;

const DARK_INK = '#1a1430';
/** Text on the fill: whichever of dark ink or white keeps the best worst-case contrast across it. */
export function accentInk(accent: string): string {
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (hex: string) => { const [r, g, b] = toRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const worst = (ink: string) => Math.min(...accentStops(accent).map((stop) => contrast(lum(ink), lum(stop))));
  return worst(DARK_INK) >= worst('#ffffff') ? DARK_INK : '#ffffff';
}
/** A random gradient that glows on the dark studio: two or three bright hues a step apart. */
export function randomStops(rand = Math.random): string[] {
  const count = rand() < 0.5 ? 2 : 3, start = rand() * 360, step = (35 + rand() * 55) * (rand() < 0.5 ? 1 : -1);
  return Array.from({ length: count }, (_, k) => hsl(start + step * k, 0.82 + rand() * 0.15, 0.64 + rand() * 0.1));
}

function hsl(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360, a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + hue / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
  return toHex([f(0), f(8), f(4)]);
}
