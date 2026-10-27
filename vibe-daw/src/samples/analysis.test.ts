import { describe, expect, it } from 'vitest';
import { estimatePitch, estimateTempo, mixStats } from './analysis';

const SR = 22050;

function clickTrack(bpm: number, seconds: number): Float32Array {
  const out = new Float32Array(SR * seconds);
  const period = (60 / bpm) * SR;
  for (let beat = 0; beat * period < out.length; beat++) {
    const start = Math.round(beat * period);
    const accent = beat % 4 === 0 ? 1 : 0.6;
    for (let i = 0; i < 400 && start + i < out.length; i++) out[start + i] += accent * Math.exp(-i / 60) * Math.sin(i * 0.9);
  }
  return out;
}

describe('estimateTempo', () => {
  for (const bpm of [90, 120, 140, 150]) {
    it(`finds ${bpm} BPM (or a half/double of it)`, () => {
      const r = estimateTempo({ sampleRate: SR, channels: [clickTrack(bpm, 12)] });
      expect(r).not.toBeNull();
      const candidates = [r!.bpm, ...r!.alternatives];
      expect(candidates.some((c) => Math.abs(c - bpm) / bpm < 0.02)).toBe(true);
      expect(Number.isFinite(r!.confidence)).toBe(true);
    });
  }
  it('returns null for silence', () => {
    expect(estimateTempo({ sampleRate: SR, channels: [new Float32Array(SR * 4)] })).toBeNull();
  });
});

describe('estimatePitch', () => {
  it('finds the fundamental of a sine', () => {
    const f = 55; // A1
    const data = new Float32Array(SR);
    for (let i = 0; i < data.length; i++) data[i] = Math.sin((2 * Math.PI * f * i) / SR) * 0.8;
    expect(estimatePitch({ sampleRate: SR, channels: [data] })?.note).toBe('A1');
  });
});

describe('mixStats', () => {
  it('reports peak and correlation', () => {
    const l = new Float32Array(SR).map((_, i) => Math.sin(i / 10) * 0.5);
    const s = mixStats({ sampleRate: SR, channels: [l, l.slice()] });
    expect(s.peakDb).toBeCloseTo(-6, 0);
    expect(s.stereoCorrelation).toBe(1);
  });
});
