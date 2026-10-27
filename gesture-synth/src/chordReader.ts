/* ─── Chord reader (Gesture mode, no audio) ───────────────────────────
 * Turns hand frames into "which chord, how loud" readings. It mirrors the
 * Gesture-mode branch of App.tsx's frame handler — chord-index stabilizer
 * (HOLD_MS), camera pinky memory for VI/VII, right-hand 3-of-5 majority
 * vote, grace period for a hand that flickers out — with no React, audio
 * or timers, so other hosts can drive it. Gesto Studio uses it to play and
 * record pads inside Vibe DAW's studio. Keep both in step when tuning. */

import type { ChordStyle } from './chords';
import type { HandFrame } from './input/types';
import { FINGER_TO_CHORD_INDEX } from './types';

const HOLD_MS = 100;
const GRACE_MS = 80;
const PINKY_MEMORY_FRAMES = 60;
const RIGHT_HISTORY = 5;

/** Left hand: wrist tilt picks major/minor, or each degree keeps its diatonic quality. */
export type HarmonyMode = 'tilt' | 'diatonicMajor' | 'diatonicMinor';
/** Right hand: finger count picks the chord style, or one style is locked. */
export type StyleMode = 'fingers' | ChordStyle;

export interface ReaderConfig {
  harmony: HarmonyMode;
  style: StyleMode;
}

export interface ChordReading {
  /** Both hands up and the left one not a fist. */
  playing: boolean;
  /** Scale degree 0–6 (I–VII). */
  chordIndex: number;
  /** Forced quality (tilt mode); undefined keeps the degree's diatonic quality. */
  modeOverride?: 'major' | 'minor';
  /** Which diatonic table the degree is read from. */
  scaleMode: 'major' | 'minor';
  chordStyle?: ChordStyle;
  /** Right thumb out: one octave down. */
  octaveDown: boolean;
  /** Right-hand height, 0.02 (low) to 1 (high). */
  volume: number;
  /** Right-hand tilt, -1..1 (the filter sweep in Gesture Synth). */
  tilt: number;
}

const SILENT: ChordReading = { playing: false, chordIndex: 0, scaleMode: 'major', octaveDown: false, volume: 0, tilt: 0 };

export class ChordReader {
  private committed: number | null = null;
  private pending = -1;
  private pendingSince = 0;
  private lastSeen: number | null = null;
  private pinkyMemory = 0;
  private rightHistory: number[] = [];
  private last: ChordReading = SILENT;

  /** One frame in, one reading out. `now` is milliseconds (performance.now() by default). */
  read(frame: HandFrame, config: ReaderConfig, now = performance.now()): ChordReading {
    const { left, right } = frame;
    let chordIndex = this.last.chordIndex;
    let harmony: 'major' | 'minor' | 'diatonicMajor' | 'diatonicMinor' =
      config.harmony === 'tilt' ? (this.last.modeOverride ?? 'major') : config.harmony;

    if (left) {
      const extended = left.extendedFingers;
      // Camera pinky detection is flaky, so a pinky seen in the last ~2 s still counts.
      // Synthetic sources (keyboard) report exact fingers and skip the memory.
      if (frame.source === 'camera') {
        if (extended.includes('pinky')) this.pinkyMemory = PINKY_MEMORY_FRAMES;
        else if (this.pinkyMemory > 0) this.pinkyMemory--;
      } else {
        this.pinkyMemory = 0;
      }
      const pinky = frame.source === 'camera' ? this.pinkyMemory > 0 : extended.includes('pinky');
      const thumb = extended.includes('thumb');
      const index = extended.includes('index');
      const middle = extended.includes('middle');
      const ring = extended.includes('ring');
      const viShape = index && pinky && !middle && !ring;
      const raw = viShape && thumb ? 6 : viShape ? 5 : FINGER_TO_CHORD_INDEX[left.fingerCount] ?? 0;

      if (raw !== this.pending) {
        this.pending = raw;
        this.pendingSince = now;
      }
      if (now - this.pendingSince >= HOLD_MS) this.committed = this.pending;
      else if (this.committed === null) this.committed = raw;
      chordIndex = this.committed ?? raw;

      if (config.harmony === 'tilt') harmony = left.tiltAngle >= 0 ? 'major' : 'minor';
    }

    let volume = 0;
    let chordStyle: ChordStyle | undefined;
    if (right) {
      this.rightHistory.push(right.fingerCount);
      if (this.rightHistory.length > RIGHT_HISTORY) this.rightHistory.shift();
      volume = Math.max(0.02, Math.min(1, 1.1 - right.positionY));
      if (config.style === 'fingers') {
        const fingers = majority(this.rightHistory) ?? right.fingerCount;
        if (fingers === 1) chordStyle = 'triad';
        else if (fingers === 2) chordStyle = 'major1stInv';
        else if (fingers === 3) chordStyle = '7th';
        else if (fingers >= 4) chordStyle = '9th';
      } else {
        chordStyle = config.style;
      }
    }

    const modeOverride = harmony === 'major' || harmony === 'minor' ? harmony : undefined;
    const scaleMode: 'major' | 'minor' = harmony === 'diatonicMinor' ? 'minor' : 'major';
    const leftFist = !left || left.fingerCount === 0;
    const playing = !!left && !!right && !leftFist;

    if (playing) {
      this.lastSeen = now;
      this.last = {
        playing: true, chordIndex, modeOverride, scaleMode, chordStyle,
        octaveDown: right!.extendedFingers.includes('thumb'), volume, tilt: right!.tiltAngle,
      };
      return this.last;
    }
    // A left fist mutes at once; a hand that drops out keeps the chord for GRACE_MS.
    const fist = !!left && left.fingerCount === 0;
    if (!fist && this.lastSeen !== null && now - this.lastSeen < GRACE_MS) return this.last;
    this.committed = null;
    this.pending = -1;
    this.lastSeen = null;
    this.last = { ...this.last, playing: false, volume: 0 };
    return this.last;
  }

  reset(): void {
    this.committed = null;
    this.pending = -1;
    this.pendingSince = 0;
    this.lastSeen = null;
    this.pinkyMemory = 0;
    this.rightHistory = [];
    this.last = SILENT;
  }
}

/** The finger count seen in at least 3 of the last 5 frames, if any. */
function majority(history: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const n of history) counts.set(n, (counts.get(n) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 0;
  counts.forEach((c, n) => {
    if (c >= 3 && c > bestCount) {
      best = n;
      bestCount = c;
    }
  });
  return best;
}
