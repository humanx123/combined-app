import { describe, expect, it } from 'vitest';
import { createProject, createTrack, createMidiClip, projectLength } from './project';
import { annotationText, exportLyrics, selectionAnnotations } from './annotations';
import { validateProject } from './validate';
import { capturePreset, insertPreset } from './presets';
import { describeProject, describeSelection } from '../agent/context';
import { diffProjects } from '../agent/diff';

function fixture() {
  const p = createProject(); p.bpm = 120;
  const t = createTrack(p, 'instrument'); t.clips.push(createMidiClip(p, 8, 8)); p.tracks.push(t);
  p.annotations = [
    { id: 'a30', kind: 'lyric', text: 'Stay with me\nUntil morning', start: 8, length: 4, author: 'user' },
    { id: 'a31', kind: 'note', text: 'Less busy drums here', start: 12, length: 4, trackId: t.id, author: 'producer', aiPending: true },
    { id: 'a32', kind: 'note', text: 'Later cue', start: 900, length: 4, author: 'user' },
  ];
  return p;
}

describe('timed annotations', () => {
  it('keeps older files compatible and validates cue content and IDs', () => {
    const p = fixture(); expect(validateProject(p).nextId).toBe(32);
    const old = { ...p, annotations: undefined }; expect(validateProject(old).annotations).toBeUndefined();
    for (const patch of [{ text: ' ' }, { start: -1 }, { length: 0 }, { author: 'other' }, { kind: 'audio' }, { id: p.tracks[0].id }, { text: 'a'.repeat(4001) }]) {
      expect(() => validateProject({ ...p, annotations: [{ ...p.annotations![0], ...patch }] })).toThrow();
    }
  });
  it('exposes only overlapping global or selected-track cues to focused edits', () => {
    const p = fixture(); const selection = { clipIds: [], range: { start: 11, end: 13, trackIds: [p.tracks[0].id] } };
    expect(selectionAnnotations(p, selection).map((a) => a.id)).toEqual(['a30', 'a31']);
    expect(selectionAnnotations(p, { ...selection, range: { ...selection.range, trackIds: ['other'] } }).map((a) => a.id)).toEqual(['a30']);
    expect(describeSelection(p, selection).text).toContain('Less busy drums here');
    expect(describeProject(p)).toContain('Stay with me');
    expect(annotationText(p, p.annotations![0])).toContain('bars 3–4');
    expect(projectLength(p)).toBeLessThan(900); // Writing cues do not lengthen audio exports.
  });
  it('exports independent lyric cues as correctly timed LRC', () => {
    expect(exportLyrics(fixture())).toBe('[00:04.00]Stay with me\n[00:04.00]Until morning\n');
  });
  it('carries timed writing cues with saved phrases and templates using fresh IDs', () => {
    const p = fixture();
    const saved = capturePreset(p, 'clip', { selection: { clipIds: [p.tracks[0].clips[0].id] } });
    expect(saved.annotations?.map((a) => a.start)).toEqual([0, 4]);
    expect(saved.annotations?.[1].aiPending).toBeUndefined();
    const target = createProject(); insertPreset(target, saved, 'clip', { at: 20 });
    expect(target.annotations?.map((a) => a.start)).toEqual([20, 24]);
    expect(target.annotations?.[1].trackId).toBe(target.tracks[0].id);
    expect(new Set(target.annotations?.map((a) => a.id)).size).toBe(2);
    expect(capturePreset(p, 'template').annotations).toHaveLength(3);
  });
  it('includes notes-only Producer edits in the review diff', () => {
    const p = fixture(); const after = { ...p, annotations: p.annotations!.map((a) => a.id === 'a31' ? { ...a, text: 'Bring hats back later' } : a) };
    expect(diffProjects(p, after).lines).toContain('~ Note: Bring hats back later');
    expect(diffProjects(p, { ...p, annotations: [] }).removed).toBe(3);
  });
});
