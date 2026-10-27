import { describe, expect, it } from 'vitest';
import { bassRootFor, bassStep, drumHits, stepsToNextBass } from './band';
import { createProject, defaultDrumLanes } from '../model/project';

const lanes = (kit: 'trap' | 'boombap' | 'lofi' | 'house') => defaultDrumLanes(createProject(), kit);
const notes = (hits: { note: number }[]) => hits.map((h) => h.note).sort((a, b) => a - b);
const KICK = 36, SNARE = 38, CLAP = 39, HAT = 42, OPENHAT = 46, PERC = 47, SHAKER = 70, CRASH = 49;

describe('band drums', () => {
  it('plays a boom bap bar with kick, snare and hats', () => {
    const l = lanes('boombap');
    expect(notes(drumHits('boombap', 0, 1, l, false))).toEqual([KICK, HAT]);
    expect(notes(drumHits('boombap', 4, 1, l, false))).toEqual([SNARE, HAT]);
    expect(drumHits('boombap', 1, 1, l, false)).toEqual([]);
  });

  it('plays dembow: four-on-the-floor kick and the 3-3-2 snare', () => {
    const l = lanes('trap');
    const snareSteps = Array.from({ length: 16 }, (_, i) => i).filter((i) => drumHits('reggaeton', i, 1, l, false).some((h) => h.note === SNARE));
    const kickSteps = Array.from({ length: 16 }, (_, i) => i).filter((i) => drumHits('reggaeton', i, 1, l, false).some((h) => h.note === KICK));
    expect(snareSteps).toEqual([3, 6, 11, 14]);
    expect(kickSteps).toEqual([0, 4, 8, 12]);
  });

  it('falls back to a related lane when the kit lacks one, and adds percussion on request', () => {
    // House has no snare: the pickup fill uses the clap.
    const house = lanes('house');
    expect(notes(drumHits('house', 2, 1, house, false))).toEqual([OPENHAT]);
    expect(drumHits('house', 15, 3, house, false).map((h) => h.note)).toContain(CLAP);
    expect(drumHits('boombap', 1, 1, lanes('boombap'), true).map((h) => h.note)).toEqual([SHAKER]);
    expect(drumHits('trap', 3, 1, lanes('trap'), true).map((h) => h.note)).toEqual([HAT, PERC]);
  });

  it('opens every 8th bar on the crash when the kit has one', () => {
    expect(drumHits('trap', 0, 8, lanes('trap'), false).map((h) => h.note)).toContain(CRASH);
    expect(drumHits('trap', 0, 9, lanes('trap'), false).map((h) => h.note)).not.toContain(CRASH);
    expect(drumHits('off', 0, 0, lanes('trap'), true)).toEqual([]);
  });

  it('keeps velocities in range with a small drift', () => {
    const v = Array.from({ length: 16 }, (_, i) => drumHits('trap', i, 2, lanes('trap'), true)).flat().map((h) => h.velocity);
    expect(Math.min(...v)).toBeGreaterThanOrEqual(0.2);
    expect(Math.max(...v)).toBeLessThanOrEqual(1);
  });
});

describe('band bass', () => {
  it('follows the kick, ringing until the next one', () => {
    expect(bassStep('kick', 'boombap', 0)).toMatchObject({ interval: 0, steps: 7 });
    expect(bassStep('kick', 'boombap', 7)).toMatchObject({ steps: 3 });
    expect(bassStep('kick', 'boombap', 10)).toMatchObject({ steps: 6 });
    expect(bassStep('kick', 'boombap', 1)).toBeNull();
  });

  it('plays roots, octaves and a walking line', () => {
    expect([0, 8].map((i) => bassStep('roots', 'trap', i)?.steps)).toEqual([8, 8]);
    expect([0, 2, 4, 6].map((i) => bassStep('octaves', 'house', i)?.interval)).toEqual([0, 12, 0, 12]);
    expect([0, 4, 8, 12].map((i) => bassStep('walk', 'lofi', i)?.interval)).toEqual([0, 7, 12, 7]);
    expect(bassStep('off', 'trap', 0)).toBeNull();
  });

  it('knows how long a chord-change hit can ring', () => {
    expect(stepsToNextBass('roots', 'trap', 3)).toBe(5);
    expect(stepsToNextBass('roots', 'trap', 12)).toBe(4);
  });

  it('puts every root in C2–B2', () => {
    expect([0, 9, 11, 21].map(bassRootFor)).toEqual([36, 45, 47, 45]);
  });
});
