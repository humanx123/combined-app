import { describe, expect, it } from 'vitest';
import { projectToMidi } from './midi';
import { createMidiClip, createProject, createTrack } from './project';
import { buildNotes } from './edit';

function readTracks(bytes: Uint8Array) {
  const dv = new DataView(bytes.buffer);
  const tracks: number[] = [];
  let o = 14;
  while (o < bytes.length) {
    expect(String.fromCharCode(...bytes.subarray(o, o + 4))).toBe('MTrk');
    const len = dv.getUint32(o + 4);
    tracks.push(len);
    o += 8 + len;
  }
  return { format: dv.getUint16(8), count: dv.getUint16(10), ppq: dv.getUint16(12), tracks };
}

describe('projectToMidi', () => {
  it('writes a valid format-1 file with one track per instrument/drum track', () => {
    const p = createProject('Test');
    p.bpm = 150;
    const keys = createTrack(p, 'instrument', { preset: 'piano' });
    const clip = createMidiClip(p, 4, 4);
    clip.notes = buildNotes([], [{ chord: 'Am', start: 0, duration: 2 }]);
    keys.clips.push(clip);
    const drums = createTrack(p, 'drums');
    const beat = createMidiClip(p, 0, 4);
    beat.notes = buildNotes([{ pitch: 36, start: 0, duration: 0.25 }, { pitch: 38, start: 1, duration: 0.25 }]);
    drums.clips.push(beat);
    p.tracks.push(keys, drums, createTrack(p, 'audio'));
    const bytes = projectToMidi(p);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('MThd');
    const info = readTracks(bytes);
    expect(info.format).toBe(1);
    expect(info.count).toBe(3); // tempo track + keys + drums (audio skipped)
    expect(info.tracks.length).toBe(3);
    expect(info.ppq).toBe(480);
    // drums on channel 10 (0x99 note-on)
    expect([...bytes].some((b, i) => b === 0x99 && bytes[i + 1] === 36)).toBe(true);
    // tempo meta event: 400000 us/beat at 150 BPM
    const tempoAt = [...bytes].findIndex((b, i) => b === 0xff && bytes[i + 1] === 0x51);
    expect((bytes[tempoAt + 3] << 16) | (bytes[tempoAt + 4] << 8) | bytes[tempoAt + 5]).toBe(400000);
  });
});
