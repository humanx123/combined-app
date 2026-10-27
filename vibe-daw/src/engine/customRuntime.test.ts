import { describe, expect, it } from 'vitest';
import { compileCustomFx, runCustomBlock } from './customRuntime';
import { checkCustomEffect } from './customCheck';
import { CUSTOM_STARTERS, customDefaults } from '../model/customEffect';

const info = { sampleRate: 48000, bpm: 120 };
const block = (v: number) => new Float32Array(128).fill(v);

describe('custom effect runtime', () => {
  it('runs top-level code once and process() per block', () => {
    const fn = compileCustomFx('let calls = 0; function process(l, r, p) { calls++; for (let i = 0; i < l.length; i++) { l[i] *= p.gain; r[i] = calls; } }', 48000, 120);
    const out = [new Float32Array(128), new Float32Array(128)];
    runCustomBlock(fn, [block(0.5), block(0.5)], out, { gain: 2 }, info);
    runCustomBlock(fn, [block(0.5), block(0.5)], out, { gain: 2 }, info);
    expect(out[0][0]).toBe(1);
    expect(out[1][0]).toBe(2);
  });

  it('feeds silence when nothing is connected and sanitizes the output', () => {
    const fn = compileCustomFx('function process(l, r) { l[0] = NaN; l[1] = 99; r[0] = -Infinity; }', 48000, 120);
    const out = [block(1), block(1)];
    expect(runCustomBlock(fn, undefined, out, {}, info)).toBe(2);
    expect([out[0][0], out[0][1], out[0][2], out[1][0]]).toEqual([0, 4, 0, 0]);
  });

  it('explains a missing process()', () => {
    expect(() => compileCustomFx('const x = 1;', 48000, 120)).toThrow(/Define function process/);
  });
});

describe('checkCustomEffect', () => {
  it.each(CUSTOM_STARTERS)('$def.name passes cleanly', async ({ def }) => {
    const check = await checkCustomEffect(def, customDefaults(def), 120);
    expect(check).toMatchObject({ ok: true, warnings: [] });
  });

  it('reports syntax errors without running anything', async () => {
    const check = await checkCustomEffect({ name: 'x', params: [], code: 'function process(l, r) { for (;; }' }, {}, 120);
    expect(check.ok).toBe(false);
    expect(check.error).toMatch(/SyntaxError/);
  });

  it('reports runtime errors and silent or exploding output', async () => {
    expect((await checkCustomEffect({ name: 'x', params: [], code: 'function process(l) { l.nope(); }' }, {}, 120)).error).toMatch(/TypeError/);
    expect((await checkCustomEffect({ name: 'x', params: [], code: 'function process(l, r) { l.fill(0); r.fill(0); }' }, {}, 120)).warnings[0]).toMatch(/silence/);
    expect((await checkCustomEffect({ name: 'x', params: [], code: 'function process(l, r) { l.fill(0 / 0); }' }, {}, 120)).warnings.join(' ')).toMatch(/NaN/);
  });
});
