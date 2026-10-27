import { describe, expect, it } from 'vitest';
import { createMidiClip, createProject, createTrack } from './project';
import { selectedNotes, selectionClips } from './selection';
import { describeSelection } from '../agent/context';

function fixture() {
  const p = createProject(); const t = createTrack(p, 'drums');
  const c = createMidiClip(p, 8, 8);
  c.notes = [
    { id: 'before', pitch: 36, start: 0, duration: 1, velocity: 0.8 },
    { id: 'crossing', pitch: 38, start: 1, duration: 2, velocity: 0.6 },
    { id: 'inside', pitch: 42, start: 2.5, duration: 0.25, velocity: 0.5 },
    { id: 'after', pitch: 36, start: 4, duration: 1, velocity: 0.9 },
  ]; t.clips.push(c); p.tracks.push(t);
  return { p, t, c };
}

describe('selection context', () => {
  it('includes only overlapping clips and notes on selected tracks, with exclusive end', () => {
    const { p, t, c } = fixture();
    const selection = { clipIds: [], range: { start: 10, end: 12, trackIds: [t.id] } };
    expect(selectionClips(p, selection)).toEqual([c.id]);
    expect(selectedNotes(p, selection, c.id).map((n) => n.id)).toEqual(['crossing', 'inside']);
    const context = describeSelection(p, selection);
    expect(context.label).toContain('2 notes');
    expect(context.text).toContain('crossing:');
    expect(context.text).toContain('@2.5 +0.25 v0.5');
    expect(context.text).not.toContain('after:');
    expect(selectionClips(p, { ...selection, range: { ...selection.range, trackIds: ['other'] } })).toEqual([]);
  });
  it('keeps discontiguous note selections exact and tolerates deleted notes', () => {
    const { p, c } = fixture();
    const selection = { clipIds: [c.id], notes: [{ clipId: c.id, noteIds: ['before', 'after', 'missing'] }] };
    expect(selectedNotes(p, selection, c.id).map((n) => n.id)).toEqual(['before', 'after']);
    expect(selectedNotes(p, { clipIds: [c.id] }, c.id)).toHaveLength(4);
  });
});
