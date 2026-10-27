import { getChordFreqs, getChordParts, getDiatonicChords } from '@gesto/chords';
import type { ChordReading, HarmonyMode } from '@gesto/chordReader';
import type { KeySignature, PitchClass, ScaleName } from '../model/types';

// Gesto mode: a hand reading (from Gesture Synth's ChordReader) becomes MIDI notes.
// Voicings come from Gesture Synth's own chords.ts, so a chord sounds the same in both apps.

export const PITCH_CLASSES: PitchClass[] = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const MINOR_SCALES = new Set<ScaleName>(['minor', 'harmonic_minor', 'melodic_minor', 'dorian', 'phrygian', 'locrian', 'pentatonic_minor', 'blues']);

/** The project's key as Gesto's starting point: its root, and which diatonic table fits its scale. */
export function gestoKeyFor(key: KeySignature): { keyOffset: number; harmony: HarmonyMode } {
  return { keyOffset: Math.max(0, PITCH_CLASSES.indexOf(key.root)), harmony: MINOR_SCALES.has(key.scale) ? 'diatonicMinor' : 'diatonicMajor' };
}

export interface VoicingOptions {
  /** Semitones above C. */
  keyOffset: number;
  /** Whole octaves added to Gesture Synth's C3 voicings. */
  octave: number;
  /** Gesture Synth's auto bass: the degree's root under the chord. */
  bass: boolean;
}

export interface Voicing {
  pitches: number[];
  bass: number | null;
  /** Pitch class (0–11) of the degree's root: what a bass line plays, whatever the inversion. */
  root: number;
  /** DAW-style name: "Am7", "F/A", "Bdim". */
  name: string;
  velocity: number;
}

const clampMidi = (m: number) => Math.max(0, Math.min(127, m));
const freqToMidi = (f: number) => Math.round(69 + 12 * Math.log2(f / 440));

/** Right-hand height → velocity: never silent at the bottom, full at the top. */
export function velocityFor(volume: number): number {
  return Math.round((0.35 + 0.65 * Math.max(0, Math.min(1, volume))) * 100) / 100;
}

/** Gesto marks minor with a lowercase root ("a7"); the studio uses "Am7". */
export function studioChordName(base: string, ext: string): string {
  const m = base.match(/^([a-g][#b]?)(.*)$/);
  if (!m) return base + ext;
  const root = m[1][0].toUpperCase() + m[1].slice(1);
  return root + (m[2].startsWith('dim') ? '' : 'm') + m[2] + ext;
}

export function voiceReading(r: ChordReading, o: VoicingOptions): Voicing {
  const shift = 12 * o.octave;
  const pitches = [...new Set(
    getChordFreqs(r.chordIndex, r.modeOverride, 0, o.keyOffset, r.chordStyle, r.octaveDown, r.scaleMode).map((f) => clampMidi(freqToMidi(f) + shift)),
  )].sort((a, b) => a - b);
  const degree = getDiatonicChords(r.scaleMode)[r.chordIndex % 7];
  // Same note Gesture Synth's bass synth plays: two octaves under middle C, and it follows the thumb.
  const bass = o.bass ? clampMidi(36 + degree.intervals[0] + o.keyOffset - (r.octaveDown ? 12 : 0) + shift) : null;
  const { base, ext } = getChordParts(r.chordIndex, r.modeOverride, o.keyOffset, r.chordStyle, r.scaleMode);
  const root = (((degree.intervals[0] + o.keyOffset) % 12) + 12) % 12;
  return { pitches, bass, root, name: studioChordName(base, ext), velocity: velocityFor(r.volume) };
}

/** Same notes, same chord: the monitor keeps ringing instead of re-attacking. */
export function sameVoicing(a: Voicing | null, b: Voicing | null): boolean {
  if (!a || !b) return a === b;
  return a.bass === b.bass && a.pitches.length === b.pitches.length && a.pitches.every((p, i) => p === b.pitches[i]);
}
