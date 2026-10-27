import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { diffProjects } from './diff';
import { createMidiClip, createProject, createTrack } from '../model/project';

describe('diffProjects', () => {
  it('summarizes added tracks, tempo and clip edits', () => {
    const a = produce(createProject(), (d) => { d.tracks.push(createTrack(d, 'drums')); });
    const b = produce(a, (d) => {
      d.bpm = 150;
      d.tracks.push(createTrack(d, 'instrument', { preset: 'bass808', name: '808' }));
      d.tracks[0].clips.push(createMidiClip(d, 0, 16, 'Hook'));
    });
    const diff = diffProjects(a, b);
    expect(diff.lines).toContain('Tempo 140 → 150 BPM');
    expect(diff.lines.some((l) => l.startsWith('+ 808'))).toBe(true);
    expect(diff.lines.some((l) => l.includes('Drums') && l.includes('+1 clip'))).toBe(true);
  });
  it('is empty for identical projects', () => {
    const a = createProject();
    expect(diffProjects(a, a).lines).toEqual([]);
  });
});
