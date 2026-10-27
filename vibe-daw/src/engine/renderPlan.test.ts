import { describe, expect, it } from 'vitest';
import { activeSpan, audibleTracks, effectTail, trackTail } from './renderPlan';
import { createMidiClip, createProject, createTrack } from '../model/project';

describe('render planning', () => {
  it('honors mute/solo while explicit stem selection overrides them', () => {
    const p = createProject();
    const a = createTrack(p, 'instrument'), b = createTrack(p, 'instrument');
    a.solo = true; b.mute = true;
    expect(audibleTracks([a, b])).toEqual([a]);
    expect(audibleTracks([a, b], [b.id])).toEqual([b]);
    expect(audibleTracks([a, b], [])).toEqual([]);
  });
  it('bounds a freeze to the actual track span rather than the song length', () => {
    const p = createProject();
    const t = createTrack(p, 'instrument');
    t.clips.push(createMidiClip(p, 16, 4), { ...createMidiClip(p, 1000, 100), muted: true });
    expect(activeSpan(t, 0, Infinity)).toEqual([16, 20]);
    expect(activeSpan(t, 18, 19)).toEqual([18, 19]);
    expect(activeSpan(t, 21, 100)).toBeNull();
  });
  it('accounts for long serial reverbs and feedback delays, including master effects', () => {
    const p = createProject();
    const t = createTrack(p, 'instrument');
    t.effects = [{ id: 'r', type: 'reverb', enabled: true, params: { decay: 6, preDelay: 0.1 } }, { id: 'd', type: 'delay', enabled: true, params: { time: '4n', feedback: 0.7 } }];
    expect(trackTail(t, 120)).toBeGreaterThan(15);
    expect(effectTail([{ id: 'm', type: 'reverb', enabled: true, params: { decay: 8 } }], 120)).toBeCloseTo(8.02);
  });
});
