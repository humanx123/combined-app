import { describe, expect, it } from 'vitest';
import { chordNotes, chordRoot, detectKey, midiToNote, noteToMidi, parseChord, parseKey, romanToChord, snapToKey, voiceLead } from './theory';

describe('note names', () => {
  it('round-trips names and MIDI numbers', () => {
    expect(noteToMidi('C4')).toBe(60);
    expect(noteToMidi('A4')).toBe(69);
    expect(noteToMidi('F#2')).toBe(42);
    expect(noteToMidi('Bb3')).toBe(58);
    expect(noteToMidi('C1')).toBe(24);
    expect(noteToMidi(61)).toBe(61);
    expect(noteToMidi('62')).toBe(62);
    expect(midiToNote(60)).toBe('C4');
    expect(midiToNote(37)).toBe('C#2');
  });
  it('rejects garbage', () => {
    expect(() => noteToMidi('H4')).toThrow();
  });
});

describe('chords', () => {
  it('parses common symbols', () => {
    expect(parseChord('Am7').intervals).toEqual([0, 3, 7, 10]);
    expect(parseChord('Fmaj7').intervals).toEqual([0, 4, 7, 11]);
    expect(parseChord('C#m').root).toBe(1);
    expect(parseChord('Bbm9').root).toBe(10);
    expect(parseChord('C/E').bass).toBe(4);
    expect(parseChord('Gsus4').intervals).toEqual([0, 5, 7]);
  });
  it('voices chords', () => {
    expect(chordNotes('C', { octave: 4 })).toEqual([60, 64, 67]);
    expect(chordNotes('C', { octave: 4, inversion: 1 })).toEqual([64, 67, 72]);
    expect(chordNotes('C/E', { octave: 4 })[0]).toBe(52);
    expect(chordRoot('F#m', 1)).toBe(30);
  });
  it('voice-leads smoothly', () => {
    const a = voiceLead(null, 'Am', 4);
    const f = voiceLead(a, 'F', 4);
    const motion = f.reduce((s, n, i) => s + Math.abs(n - a[i]), 0);
    expect(motion).toBeLessThanOrEqual(4);
  });
  it('resolves roman numerals in a key', () => {
    const am = { root: 'A' as const, scale: 'minor' as const };
    expect(romanToChord('i', am)).toBe('Am');
    expect(romanToChord('VI', am)).toBe('F');
    expect(romanToChord('III', am)).toBe('C');
    expect(romanToChord('VII', am)).toBe('G');
    expect(romanToChord('V7', { root: 'C', scale: 'major' })).toBe('G7');
    expect(romanToChord('ii7', { root: 'C', scale: 'major' })).toBe('Dm7');
    expect(romanToChord('bVII', { root: 'C', scale: 'major' })).toBe('A#');
  });
});

describe('keys', () => {
  it('parses key names', () => {
    expect(parseKey('C# minor')).toEqual({ root: 'C#', scale: 'minor' });
    expect(parseKey('Ebm')).toEqual({ root: 'D#', scale: 'minor' });
    expect(parseKey('F major')).toEqual({ root: 'F', scale: 'major' });
    expect(parseKey('A dorian')).toEqual({ root: 'A', scale: 'dorian' });
    expect(parseKey('nope')).toBeNull();
  });
  it('snaps to key', () => {
    const cmin = { root: 'C' as const, scale: 'minor' as const };
    expect(snapToKey(64, cmin)).toBe(63);
    expect(snapToKey(60, cmin)).toBe(60);
  });
  it('detects a key from chroma', () => {
    const chroma = new Array(12).fill(0.02);
    chroma[9] = 0.3; chroma[0] = 0.2; chroma[4] = 0.25; chroma[2] = 0.08; chroma[7] = 0.06; chroma[5] = 0.05;
    const { key } = detectKey(chroma);
    expect(key.root).toBe('A');
    expect(key.scale).toBe('minor');
  });
});
