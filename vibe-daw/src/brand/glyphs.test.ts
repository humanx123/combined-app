import { describe, expect, it } from 'vitest';
import { GLYPHS, MARK, WEIGHT, WORDMARK } from './glyphs';

const points = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('wordmark', () => {
  it('spells Vibe with letters that never touch', () => {
    expect(WORDMARK.letters.map((l) => l.name).join('')).toBe('Vibe');
    WORDMARK.letters.slice(1).forEach((letter, k) => {
      const prev = WORDMARK.letters[k];
      expect(letter.x - (prev.x + GLYPHS[prev.name].width)).toBeGreaterThan(WEIGHT / 3);
    });
    const last = WORDMARK.letters.at(-1)!;
    expect(WORDMARK.width).toBeCloseTo(last.x + GLYPHS[last.name].width, 1);
  });

  it('floats the dot clear above the i and level with the tops of the tall letters', () => {
    const dot = GLYPHS.i.dot!, stemTop = points(GLYPHS.i.d)[1] - WEIGHT / 2;
    expect(stemTop - (dot.cy + dot.r)).toBeGreaterThan(WEIGHT / 2);
    expect(dot.cy - dot.r).toBeCloseTo(0, 1);
  });
});

describe('mark', () => {
  it('holds the dot between the arms without touching them', () => {
    const [ax, ay, bx, by] = points(MARK.glyph.d);
    const { cx, cy, r } = MARK.dot;
    const toArm = Math.abs((bx - ax) * (ay - cy) - (by - ay) * (ax - cx)) / Math.hypot(bx - ax, by - ay);
    expect(cx).toBe(MARK.width / 2);
    expect(toArm - MARK.glyph.weight / 2 - r).toBeGreaterThan(MARK.glyph.weight * 0.4);
    expect(cy - r).toBeGreaterThan(0);
  });
});
