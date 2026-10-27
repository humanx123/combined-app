import { describe, expect, it } from 'vitest';
import { parseMidi, insertMidi } from './midiImport';
import { projectToMidi } from './midi';
import { createMidiClip, createProject, createTrack } from './project';
import { validateProject } from './validate';
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
function file(events: number[], options: { format?: number; division?: number } = {}) {
  const division = options.division ?? 480;
  return new Uint8Array([77,84,104,100,0,0,0,6,0,options.format ?? 0,0,1,division >> 8, division & 255,77,84,114,107,...u32(events.length),...events]).buffer;
}
describe('MIDI import', () => {
  it('reads running status, sustain, tempo and meter without flattening note timing', () => {
    const midi = parseMidi(file([
      0,0xff,0x51,3,0x07,0xa1,0x20, 0,0xff,0x58,4,3,2,24,8,
      0,0xc0,0, 0,0x90,60,100, 0x81,0x70,62,80,
      0,0xb0,64,127, 0x81,0x70,0x80,60,0, 0,62,0,
      0x83,0x60,0xb0,64,0, 0,0xff,0x2f,0,
    ]));
    expect(midi.bpm).toBe(120); expect(midi.timeSignature).toEqual([3,4]);
    expect(midi.tracks[0].notes).toMatchObject([{ pitch: 60, start: 0, duration: 2 }, { pitch: 62, start: 0.5, duration: 1.5 }]);
    expect(midi.warnings).toEqual([]);
  });
  it('round-trips exported melodic and channel-10 drum notes and adds playable drum lanes', () => {
    const p = createProject(); p.bpm = 150;
    for (const kind of ['instrument', 'drums'] as const) {
      const t = createTrack(p, kind), c = createMidiClip(p, 4, 4);
      c.notes = [{ id: kind, pitch: kind === 'drums' ? 35 : 64, start: 1, duration: 0.25, velocity: 0.8 }]; t.clips.push(c); p.tracks.push(t);
    }
    const bytes = projectToMidi(p); const midi = parseMidi(bytes.buffer as ArrayBuffer);
    expect(midi.tracks).toHaveLength(2); expect(midi.bpm).toBe(150);
    const dest = createProject(); insertMidi(dest, midi, 8); validateProject(dest);
    expect(dest.bpm).toBe(150); expect(dest.tracks[0].clips[0].start).toBe(8);
    expect(dest.tracks[1].drumLanes).toMatchObject([{ note: 35, sampleId: 'b-kick-punchy' }]);
  });
  it('splits mixed channels in format 0 and treats velocity-zero note-on as note-off', () => {
    const midi = parseMidi(file([0,0x90,60,100,0,0x99,36,110,0x83,0x60,0x90,60,0,0,0x89,36,0,0,0xff,0x2f,0]));
    expect(midi.tracks.map((t) => t.channel)).toEqual([0,9]); expect(midi.tracks[0].notes[0].duration).toBe(1);
  });
  it('preserves the destination tempo and composition and exposes unsupported automation', () => {
    const midi = parseMidi(file([0,0x90,60,90,0,0xe0,0,64,0x83,0x60,0x80,60,0,0,0xff,0x2f,0]));
    expect(midi.warnings.join(' ')).toContain('not imported');
    const dest = createProject(); dest.bpm = 97; dest.tracks.push(createTrack(dest, 'instrument'));
    const original = structuredClone(dest.tracks[0]); insertMidi(dest, { ...midi, bpm: 120 }, 16);
    expect(dest.bpm).toBe(97); expect(dest.tracks[0]).toEqual(original);
  });
  it('rejects corrupt headers, chunks, running status and unsupported clocks', () => {
    expect(() => parseMidi(new ArrayBuffer(2))).toThrow('Truncated');
    expect(() => parseMidi(file([0,0xff,0x2f,0], { format: 2 }))).toThrow('formats 0 and 1');
    expect(() => parseMidi(file([], { division: 0xe728 }))).toThrow('SMPTE');
    expect(() => parseMidi(file([0,60,100]))).toThrow('running status');
    expect(() => parseMidi(file([0x80,0x80,0x80,0x80]))).toThrow('variable-length');
    expect(() => parseMidi(file([0,0x90,60]))).toThrow('Truncated');
  });
});
