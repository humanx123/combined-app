import { describe, expect, it } from 'vitest';
import { validateProject } from './validate';
import { createAudioClip, createMidiClip, createProject, createTrack } from './project';

describe('project validation', () => {
  it('round-trips instrument settings, effects and notes without losing their values', () => {
    const p = createProject();
    const t = createTrack(p, 'instrument', { preset: 'bass808' });
    const c = createMidiClip(p, 4, 8);
    c.notes.push({ id: 'n', pitch: 36, start: 0, duration: 2, velocity: 0.8 });
    t.effects.push({ id: 'fx8', type: 'duck', enabled: true, params: { depth: 0.4, source: 't9' } });
    t.clips.push(c); p.tracks.push(t);
    expect(validateProject(JSON.parse(JSON.stringify(p)))).toEqual({ ...p, nextId: 8 });
  });
  it('rejects corrupt timing, duplicate ids and unsupported effects', () => {
    const p = createProject();
    expect(() => validateProject({ ...p, bpm: NaN })).toThrow();
    expect(() => validateProject({ ...p, timeSignature: [4, 0] })).toThrow();
    const t = createTrack(p, 'audio');
    const c = createAudioClip(p, 's1', 0, 4);
    t.clips.push(c, { ...c }); p.tracks.push(t);
    expect(() => validateProject(p)).toThrow(/duplicate/);
    t.clips.pop(); c.pitch = Infinity;
    expect(() => validateProject(p)).toThrow(/pitch/);
  });
});
