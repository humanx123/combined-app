import { describe, expect, it, vi } from 'vitest';
import { cachedPeaks, peaksForBuffer } from './waveform';

function buffer(value = 0.5) {
  const data = Float32Array.from({ length: 4096 }, (_, i) => i < 2048 ? value : 0.1);
  return { length: data.length, numberOfChannels: 1, getChannelData: vi.fn(() => data) };
}

describe('shared waveform peaks', () => {
  it('scans shared audio once, including reversed clips, without mutating forward peaks', () => {
    const audio = buffer();
    expect(cachedPeaks(audio)).toBeNull();
    const forward = peaksForBuffer(audio);
    expect(peaksForBuffer(audio)).toBe(forward);
    const reverse = peaksForBuffer(audio, true);
    expect(peaksForBuffer(audio, true)).toBe(reverse);
    expect(cachedPeaks(audio, true)).toBe(reverse);
    expect(reverse).toEqual(forward.slice().reverse());
    expect(forward[0]).toBe(0.5);
    expect(audio.getChannelData).toHaveBeenCalledTimes(1);
  });

  it('recomputes peaks when decoded audio is replaced', () => {
    const original = buffer(), replacement = buffer(0.8);
    const first = peaksForBuffer(original);
    expect(cachedPeaks(replacement)).toBeNull();
    const second = peaksForBuffer(replacement);
    expect(second).not.toBe(first);
    expect(second[0]).toBeCloseTo(0.8);
    expect(replacement.getChannelData).toHaveBeenCalledTimes(1);
  });
});
