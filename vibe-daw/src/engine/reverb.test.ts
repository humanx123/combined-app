import { describe, expect, it } from 'vitest';
import { impulseChannels } from './reverb';

describe('reverb consistency', () => {
  it('uses exactly the same stereo impulse for playback and subsequent bounces', () => {
    const a = impulseChannels(44100, 2, 0.02, 'fx7');
    const b = impulseChannels(44100, 2, 0.02, 'fx7');
    expect(a).toEqual(b);
    expect(a[0]).not.toEqual(a[1]);
    expect(a[0].length).toBe(Math.ceil(44100 * 2.02));
    expect(a[0].subarray(0, 882).every((v) => v === 0)).toBe(true);
    expect(Math.abs(a[0][a[0].length - 1])).toBeLessThan(1e-5);
  });
});
