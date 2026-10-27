import { describe, expect, it } from 'vitest';
import { GRADIENT_PRESETS, SOLID_PRESETS, VIBE_ACCENT, accentFill, accentInk, accentSolid, accentStops, colorAt, randomStops, sanitizeAccent, stopsToAccent } from './accent';

describe('accents', () => {
  it('keeps colors and gradients of 2 to 4 stops, and nothing that could reach CSS', () => {
    expect(sanitizeAccent('#5CC8FF')).toBe('#5cc8ff');
    expect(sanitizeAccent('#abc')).toBe('#aabbcc');
    expect(sanitizeAccent('g:#ff0000,#00ff00,#0000ff')).toBe('g:#ff0000,#00ff00,#0000ff');
    for (const bad of ['g:#ff0000', 'g:#111111,#222222,#333333,#444444,#555555', 'g:#ff0000,red', 'red; background: url(x)', 'g:#ff0000,#00ff00);x', 42, null])
      expect(sanitizeAccent(bad)).toBe(VIBE_ACCENT);
    // The old default lilac moves to the gradient.
    expect(sanitizeAccent('#B69CFF')).toBe(VIBE_ACCENT);
  });

  it('turns stops into an accent and back', () => {
    for (const accent of [VIBE_ACCENT, '#5cc8ff', 'g:#3ddc97,#5cc8ff']) expect(stopsToAccent(accentStops(accent))).toBe(accent);
    expect(stopsToAccent(['#B69CFF', '#FF8FCF', '#FFB547'])).toBe(VIBE_ACCENT);
    for (const p of [...GRADIENT_PRESETS.map((g) => g.accent), ...SOLID_PRESETS]) expect(sanitizeAccent(p)).toBe(p);
  });

  it('samples the gradient for lines and text, and paints fills as an image', () => {
    expect(accentSolid(VIBE_ACCENT)).toBe('#ff8fcf');
    expect(colorAt(['#000000', '#ffffff'], 0.5)).toBe('#808080');
    expect(colorAt(['#ff0000'], 0.9)).toBe('#ff0000');
    expect(accentFill('#5cc8ff')).toBe('linear-gradient(100deg, #5cc8ff, #5cc8ff)');
  });

  it('writes dark text on bright fills and white text on dark ones', () => {
    expect(accentInk(VIBE_ACCENT)).toBe('#1a1430');
    expect(accentInk('g:#1b1464,#3a0ca3')).toBe('#ffffff');
  });

  it('rolls valid, bright gradients', () => {
    let seed = 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 50; k++) {
      const stops = randomStops(rand);
      expect(stops.length).toBeGreaterThanOrEqual(2);
      expect(sanitizeAccent(stopsToAccent(stops))).toBe(stopsToAccent(stops));
      expect(accentInk(stopsToAccent(stops))).toBe('#1a1430');
    }
  });
});
