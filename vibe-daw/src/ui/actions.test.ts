import { beforeEach, describe, expect, it } from 'vitest';
import { useDaw } from '../state/store';
import { cloneDeep, createMidiClip, createProject, createTrack } from '../model/project';
import { duplicateSelectedClips } from './actions';
import { produce } from 'immer';

beforeEach(() => useDaw.getState().replaceProject(createProject()));
describe('clip copying', () => {
  it('clones an Immer draft without a DataCloneError or shared notes', () => {
    const p = createProject();
    const t = createTrack(p, 'instrument');
    const c = createMidiClip(p, 0, 4);
    c.notes.push({ id: 'n', pitch: 60, start: 0, duration: 1, velocity: 0.8 });
    t.clips.push(c); p.tracks.push(t);
    const next = produce(p, (d) => {
      const copied = cloneDeep(d.tracks[0].clips[0]);
      if (copied.type === 'midi') copied.notes[0].pitch = 64;
      d.tracks[0].clips.push(copied);
    });
    expect(next.tracks[0].clips[0]).toEqual(c);
    expect(next.tracks[0].clips[1]).not.toEqual(c);
  });
  it('duplicates clips across tracks as one aligned selection', () => {
    const p = createProject();
    const a = createTrack(p, 'instrument'), b = createTrack(p, 'instrument');
    const ca = createMidiClip(p, 0, 4), cb = createMidiClip(p, 2, 8);
    a.clips.push(ca); b.clips.push(cb); p.tracks.push(a, b);
    useDaw.getState().replaceProject(p);
    useDaw.getState().select({ clipIds: [ca.id, cb.id] });
    duplicateSelectedClips();
    const result = useDaw.getState().project;
    expect(result.tracks[0].clips[1].start).toBe(10);
    expect(result.tracks[1].clips[1].start).toBe(12);
    useDaw.getState().undo();
    expect({ ...useDaw.getState().project, updatedAt: p.updatedAt }).toEqual(p);
    expect(useDaw.getState().project.updatedAt).toBeGreaterThanOrEqual(p.updatedAt);
  });
});
