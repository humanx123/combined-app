import { describe, expect, it } from 'vitest';
import { wsola } from './stretch';
import { estimatePitch } from '../samples/analysis';

const SR = 44100;
const tone = (hz: number, seconds: number) => Float32Array.from({ length: SR * seconds }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / SR));
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('wsola', () => {
  it('rejects invalid speeds and mismatched channel lengths', () => {
    for (const speed of [0, -1, NaN, Infinity]) expect(() => wsola([new Float32Array(100)], speed)).toThrow(RangeError);
    expect(() => wsola([new Float32Array(100), new Float32Array(50)], 1.2)).toThrow(RangeError);
  });
  it('changes length by the speed factor', () => {
    const out = wsola([tone(220, 2)], 1.25);
    expect(out[0].length).toBe(Math.round((SR * 2) / 1.25));
    expect(wsola([tone(220, 2)], 0.8)[0].length).toBe(Math.round((SR * 2) / 0.8));
  });
  it('keeps pitch and level', () => {
    const src = tone(220, 2);
    const out = wsola([src], 1.3)[0];
    expect(estimatePitch({ sampleRate: SR, channels: [out] })?.note).toBe('A3');
    const body = out.subarray(SR * 0.2, out.length - SR * 0.2);
    expect(Math.abs(20 * Math.log10(rms(body) / rms(src)))).toBeLessThan(1.5);
  });
  it('processes stereo with identical lengths', () => {
    const out = wsola([tone(220, 1), tone(330, 1)], 0.9);
    expect(out.length).toBe(2);
    expect(out[0].length).toBe(out[1].length);
  });
});
