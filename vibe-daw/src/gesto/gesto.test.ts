import { describe, expect, it } from 'vitest';
import type { ChordReading } from '@gesto/chordReader';
import { gestoKeyFor, studioChordName, velocityFor, voiceReading, sameVoicing } from './voicing';
import { LiveTake } from './take';

const reading = (patch: Partial<ChordReading> = {}): ChordReading => ({ playing: true, chordIndex: 0, scaleMode: 'major', octaveDown: false, volume: 1, tilt: 0, ...patch });
const opts = { keyOffset: 0, octave: 0, bass: false };

describe('Gesto voicing', () => {
  it('voices C major from Gesture Synth tables at C3', () => {
    expect(voiceReading(reading(), opts)).toMatchObject({ pitches: [48, 52, 55], bass: null, name: 'C', velocity: 1 });
  });

  it('follows key, degree, minor table, style, octave and thumb', () => {
    // A minor key (offset 9), degree iv in the natural-minor table, 7th style, one octave up
    const v = voiceReading(reading({ chordIndex: 3, scaleMode: 'minor', chordStyle: '7th' }), { keyOffset: 9, octave: 1, bass: true });
    expect(v.name).toBe('Dm7');
    expect(v.pitches).toEqual([74, 77, 81, 84]);
    expect(v.bass).toBe(36 + 5 + 9 + 12);
    const down = voiceReading(reading({ octaveDown: true }), { ...opts, bass: true });
    expect(down.pitches[0]).toBe(36);
    expect(down.bass).toBe(24);
  });

  it('names chords the studio way', () => {
    expect(studioChordName('a', '7')).toBe('Am7');
    expect(studioChordName('bdim', '')).toBe('Bdim');
    expect(studioChordName('c#', '9')).toBe('C#m9');
    expect(studioChordName('F', '/A')).toBe('F/A');
  });

  it('maps hand height to velocity and project keys to a starting point', () => {
    expect(velocityFor(0)).toBe(0.35);
    expect(velocityFor(0.5)).toBeCloseTo(0.68);
    expect(gestoKeyFor({ root: 'A', scale: 'minor' })).toEqual({ keyOffset: 9, harmony: 'diatonicMinor' });
    expect(gestoKeyFor({ root: 'F#', scale: 'lydian' })).toEqual({ keyOffset: 6, harmony: 'diatonicMajor' });
  });

  it('treats a volume change as the same chord', () => {
    expect(sameVoicing(voiceReading(reading({ volume: 0.2 }), opts), voiceReading(reading({ volume: 0.9 }), opts))).toBe(true);
    expect(sameVoicing(voiceReading(reading(), opts), voiceReading(reading({ chordIndex: 4 }), opts))).toBe(false);
  });
});

describe('Gesto live take', () => {
  const C = voiceReading(reading(), opts);
  const G = voiceReading(reading({ chordIndex: 4 }), opts);

  it('quantizes chord changes and builds a bar-aligned clip', () => {
    const take = new LiveTake({ quantize: 1, arp: 0, beatsPerBar: 4 });
    take.set(4.1, C);
    take.set(7.9, G);
    take.set(9.6, null);
    const res = take.finish(12)!;
    expect(res).toMatchObject({ start: 4, length: 8, chords: ['C', 'G'] });
    const cNotes = res.notes.filter((n) => n.start === 0);
    expect(cNotes.map((n) => n.pitch)).toEqual([48, 52, 55]);
    expect(cNotes[0].duration).toBe(4);
    const gNotes = res.notes.filter((n) => n.start === 4);
    expect(gNotes.every((n) => n.duration === 2)).toBe(true);
  });

  it('drops passing shapes shorter than half a grid step', () => {
    const take = new LiveTake({ quantize: 1, arp: 0, beatsPerBar: 4 });
    take.set(0, C);
    take.set(2.0, G);
    take.set(2.3, C);
    const res = take.finish(4)!;
    expect(res.chords).toEqual(['C']);
    expect(res.notes.every((n) => n.pitch !== 59)).toBe(true);
  });

  it('arpeggiates upward on the beat grid with the bass held', () => {
    const take = new LiveTake({ quantize: 0, arp: 0.5, beatsPerBar: 4 });
    take.set(0, { ...C, bass: 36 });
    const res = take.finish(2)!;
    expect(res.notes.find((n) => n.pitch === 36)).toMatchObject({ start: 0, duration: 2 });
    const steps = res.notes.filter((n) => n.pitch !== 36);
    expect(steps.map((n) => [n.pitch, n.start])).toEqual([[48, 0], [52, 0.5], [55, 1], [48, 1.5]]);
    expect(steps[1].velocity).toBeCloseTo(0.88);
    expect(steps[0].duration).toBeCloseTo(0.475);
  });

  it('splits a chord across a loop wrap', () => {
    const take = new LiveTake({ quantize: 0, arp: 0, beatsPerBar: 4 });
    take.set(6, C);
    take.wrap(8, 0);
    const res = take.finish(1)!;
    expect(res.start).toBe(0);
    expect(res.length).toBe(8);
    expect(res.notes.filter((n) => n.pitch === 48).map((n) => [n.start, n.duration])).toEqual([[6, 2], [0, 1]]);
  });

  it('returns nothing when nothing was held', () => {
    expect(new LiveTake({ quantize: 1, arp: 0, beatsPerBar: 4 }).finish(8)).toBeNull();
  });
});
