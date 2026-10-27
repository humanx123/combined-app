import { describe, expect, it } from 'vitest';
import { encodeWav, resample } from './wav';

describe('audio encoding and resampling', () => {
  it('encodes stereo 24-bit PCM with the correct sample rate and signed values', () => {
    const data = new DataView(encodeWav({ sampleRate: 48000, channels: [new Float32Array([-1, 1]), new Float32Array([0.5, -0.5])] }, 24));
    expect(data.getUint16(22, true)).toBe(2);
    expect(data.getUint32(24, true)).toBe(48000);
    expect(data.getUint16(34, true)).toBe(24);
    expect(data.getUint32(40, true)).toBe(12);
    expect([data.getUint8(44), data.getUint8(45), data.getUint8(46)]).toEqual([0, 0, 128]);
  });
  it('removes aliased treble when making compact audio while keeping bass', () => {
    const tone = (hz: number) => Float32Array.from({ length: 44100 }, (_, i) => Math.sin(2 * Math.PI * hz * i / 44100));
    const rms = (data: Float32Array) => Math.sqrt(data.subarray(100, data.length - 100).reduce((sum, x) => sum + x * x, 0) / (data.length - 200));
    expect(rms(resample(tone(440), 44100, 16000))).toBeGreaterThan(0.65);
    expect(rms(resample(tone(12000), 44100, 16000))).toBeLessThan(0.01);
    expect(() => resample(tone(440), 0, 16000)).toThrow(RangeError);
  });
});
