import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { buildNotes, clearRange, copyRange, parseSteps, repeatNotes, sliceClip, transformNotes } from './edit';
import { createAudioClip, createMidiClip, createProject, createTrack } from './project';
import type { AudioClip, MidiClip, Project } from './types';

function projectWithClip(): Project {
  const p = createProject();
  const t = createTrack(p, 'instrument', { preset: 'piano' });
  const c = createMidiClip(p, 0, 8, 'A');
  c.notes = buildNotes([
    { pitch: 'C4', start: 0, duration: 1 },
    { pitch: 'E4', start: 3.5, duration: 2 },
    { pitch: 'G4', start: 6, duration: 1 },
  ]);
  t.clips.push(c);
  p.tracks.push(t);
  return p;
}

describe('drum step patterns', () => {
  it('parses hits, accents, ghosts and rolls', () => {
    const hits = parseSteps('hat', 'xX o.3...', 8, 4, 4);
    expect(hits.map((h) => h.beat)).toEqual([0, 0.5, 1, 2, 2 + 1 / 6, 2 + 2 / 6]);
    expect(hits[1].velocity).toBeGreaterThan(hits[0].velocity);
    expect(hits[2].velocity).toBeLessThan(hits[0].velocity);
  });
  it('repeats short patterns across the clip', () => {
    expect(parseSteps('kick', 'x...', 16, 4, 8).length).toBe(8);
  });
  it('rejects unknown characters', () => {
    expect(() => parseSteps('kick', 'x..z', 16, 4, 4)).toThrow();
  });
});

describe('note building', () => {
  it('builds strummed chords and arps', () => {
    const strum = buildNotes([], [{ chord: 'Am', start: 0, duration: 4, strum: 0.05 }]);
    expect(strum.map((n) => n.start)).toEqual([0, 0.05, 0.1]);
    const arp = buildNotes([], [{ chord: 'Am', start: 0, duration: 2, arp: 'up', arp_rate: 0.5 }]);
    expect(arp.map((n) => n.pitch)).toEqual([69, 72, 76, 69]);
  });
  it('repeats patterns', () => {
    const notes = buildNotes([{ pitch: 'C4', start: 0, duration: 1 }, { pitch: 'D4', start: 2, duration: 1 }]);
    const r = repeatNotes(notes, 4, 16);
    expect(r.length).toBe(8);
    expect(r[r.length - 1].start).toBe(14);
  });
  it('normalizes MIDI-style velocities', () => {
    expect(buildNotes([{ pitch: 60, start: 0, duration: 1, velocity: 100 }])[0].velocity).toBeCloseTo(100 / 127);
  });
});

describe('clip slicing & arrangement', () => {
  it('slices MIDI clips, clipping note durations', () => {
    produce(projectWithClip(), (d) => {
      const c = sliceClip(d, d.tracks[0].clips[0], 2, 6) as MidiClip;
      expect(c.start).toBe(2);
      expect(c.length).toBe(4);
      expect(c.notes.length).toBe(1);
      expect(c.notes[0].start).toBe(1.5);
      expect(c.notes[0].duration).toBe(2);
    });
  });
  it('clears a range by splitting clips', () => {
    const p = produce(projectWithClip(), (d) => clearRange(d, d.tracks[0], 2, 4));
    const clips = [...p.tracks[0].clips].sort((a, b) => a.start - b.start);
    expect(clips.map((c) => [c.start, c.length])).toEqual([[0, 2], [4, 4]]);
    // The sustained E4 survives on the right of the cut instead of disappearing.
    expect((clips[1] as MidiClip).notes.map((n) => n.start)).toEqual([0, 2]);
    expect((clips[1] as MidiClip).notes[0].duration).toBe(1.5);
  });
  it('copies bars to a destination', () => {
    const p = produce(projectWithClip(), (d) => { copyRange(d, null, 0, 8, 8); });
    expect(p.tracks[0].clips.length).toBe(2);
    expect(p.tracks[0].clips[1].start).toBe(8);
  });
  it('advances audio offsets when slicing', () => {
    const p = createProject();
    p.bpm = 120;
    const t = createTrack(p, 'audio');
    t.clips.push(createAudioClip(p, 's1', 0, 8));
    p.tracks.push(t);
    produce(p, (d) => {
      const s = sliceClip(d, d.tracks[0].clips[0], 4, 8) as AudioClip;
      expect(s.offset).toBeCloseTo(2);
    });
  });
});

describe('note transforms', () => {
  it('transposes, quantizes and snaps to key', () => {
    produce(projectWithClip(), (d) => {
      const c = d.tracks[0].clips[0] as MidiClip;
      transformNotes(c, 'transpose', 2, d.key);
      expect(c.notes[0].pitch).toBe(62);
      c.notes[0].start = 0.13;
      transformNotes(c, 'quantize', 0.25, d.key);
      expect(c.notes[0].start).toBe(0.25);
      transformNotes(c, 'snap_to_key', undefined, { root: 'C', scale: 'minor' });
      expect(c.notes.map((n) => n.pitch)).toEqual([62, 65, 68]);
    });
  });
});
