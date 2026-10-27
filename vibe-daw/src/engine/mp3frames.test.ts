import { describe, expect, it } from 'vitest';
import { FRAME, planMp3Chunks, splitFrames } from './mp3frames';
import { encodeMp3Chunk } from './mp3encode';

function signal(sampleRate: number, seconds: number) {
  const n = Math.round(sampleRate * seconds), left = new Float32Array(n), right = new Float32Array(n);
  let seed = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate, beat = (t * 2) % 1;
    seed = (seed * 16807) % 2147483647;
    const hat = 0.15 * Math.exp(-((t * 8) % 1) * 30) * (seed / 2147483647 - 0.5);
    const tone = 0.2 * Math.sin(2 * Math.PI * 220 * t) + 0.3 * Math.exp(-beat * 12) * Math.sin(2 * Math.PI * 440 * t);
    left[i] = tone + hat;
    right[i] = 0.8 * tone - hat;
  }
  return { left, right };
}

describe('parallel MP3 encoding', () => {
  it.each([44100, 48000])('joins chunks into exactly the single-pass file at %i Hz', (sampleRate) => {
    const { left, right } = signal(sampleRate, 8);
    const chunks = planMp3Chunks(left.length, sampleRate, 320, 3, 40);
    expect(chunks).toHaveLength(3);
    const joined = chunks.map((c) => encodeMp3Chunk(left.slice(c.from, c.to), right.slice(c.from, c.to), sampleRate, 320, c));
    const bytes = new Uint8Array(joined.reduce((n, b) => n + b.length, 0));
    let at = 0;
    for (const b of joined) { bytes.set(b, at); at += b.length; }
    expect(Buffer.from(bytes).equals(Buffer.from(encodeMp3Chunk(left, right, sampleRate, 320, { skip: 0, keep: null })))).toBe(true);
  });

  it('plans contiguous chunks that start on the padding cycle', () => {
    const samples = 44100 * 180;
    const chunks = planMp3Chunks(samples, 44100, 320, 4);
    expect(chunks).toHaveLength(4);
    let next = 0;
    for (const [i, c] of chunks.entries()) {
      expect(c.from / FRAME + c.skip).toBe(next);
      expect((c.from / FRAME) % 49).toBe(0); // 320 kbps at 44.1 kHz pads in a 49-frame cycle
      if (i < chunks.length - 1) { expect(c.to).toBeLessThan(samples); next += c.keep!; }
      else { expect(c.keep).toBeNull(); expect(c.to).toBe(samples); }
    }
  });

  it('encodes short songs and other rates in one pass', () => {
    expect(planMp3Chunks(48000 * 5, 48000, 320, 4)).toEqual([{ from: 0, to: 240000, skip: 0, keep: null }]);
    expect(planMp3Chunks(24000 * 300, 24000, 320, 4)).toHaveLength(1);
  });

  it('rejects bytes that are not MPEG-1 Layer III frames', () => {
    expect(() => splitFrames(new Uint8Array([0xff, 0xfb, 0x00, 0x00]))).toThrow(/header/);
    expect(() => splitFrames(new Uint8Array([0x49, 0x44, 0x33, 0x04]))).toThrow(/sync/);
  });
});
