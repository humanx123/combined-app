import { uid } from '../model/project';
import type { Note } from '../model/types';
import type { Voicing } from './voicing';

// A live take in Gesto mode: chord changes timestamped in song beats, turned into the notes
// of one MIDI clip when recording stops. Pure: the session feeds it beats from the transport.

export interface TakeOptions {
  /** Grid in beats for chord starts and ends; 0 keeps the played timing. */
  quantize: number;
  /** Arpeggiator step in beats; 0 holds the chord. */
  arp: number;
  beatsPerBar: number;
}

export interface TakeResult {
  /** Clip start in song beats (bar-aligned). */
  start: number;
  /** Clip length in beats (whole bars). */
  length: number;
  notes: Note[];
  /** Chord names in played order, for the clip name. */
  chords: string[];
}

interface Segment { start: number; end: number; v: Voicing }

const EPS = 1e-6;

export class LiveTake {
  private segments: Segment[] = [];
  private open: { start: number; v: Voicing } | null = null;

  constructor(private readonly opts: TakeOptions) {}

  /** The sounding chord changed at `beat`; null means silence. */
  set(beat: number, v: Voicing | null) {
    this.close(beat);
    if (v) this.open = { start: beat, v };
  }

  /** The song looped back: what was sounding ends at the loop end and carries on from the loop start. */
  wrap(loopEnd: number, loopStart: number) {
    const v = this.open?.v ?? null;
    this.close(loopEnd);
    if (v) this.open = { start: loopStart, v };
  }

  /** Chords captured so far (including the one still sounding). */
  get count(): number {
    return this.segments.length + (this.open ? 1 : 0);
  }

  private close(beat: number) {
    if (this.open && beat > this.open.start + EPS) this.segments.push({ start: this.open.start, end: beat, v: this.open.v });
    this.open = null;
  }

  private snap(beat: number): number {
    const q = this.opts.quantize;
    return q > 0 ? Math.round(beat / q) * q : beat;
  }

  /** Stop at `beat` and build the clip; null when nothing long enough was played. */
  finish(beat: number): TakeResult | null {
    this.close(beat);
    const q = this.opts.quantize;
    const placed: Segment[] = [];
    for (const seg of this.segments) {
      const start = Math.max(0, this.snap(seg.start));
      let end = this.snap(seg.end);
      // A chord shorter than half a grid step was a passing shape; anything longer keeps one step.
      if (end - start < EPS) {
        if (q > 0 && seg.end - seg.start >= q / 2) end = start + q;
        else if (q > 0) continue;
      }
      if (end - start < EPS) continue;
      placed.push({ start, end, v: seg.v });
    }
    if (!placed.length) return null;

    const bpb = this.opts.beatsPerBar;
    const clipStart = Math.floor(Math.min(...placed.map((s) => s.start)) / bpb + EPS) * bpb;
    const clipEnd = Math.max(clipStart + bpb, Math.ceil(Math.max(...placed.map((s) => s.end)) / bpb - EPS) * bpb);
    const notes: Note[] = [];
    const add = (pitch: number, start: number, duration: number, velocity: number) => {
      if (duration > EPS) notes.push({ id: uid(), pitch, start: start - clipStart, duration, velocity });
    };
    for (const seg of placed) {
      const { pitches, bass, velocity } = seg.v;
      const length = seg.end - seg.start;
      if (bass !== null) add(bass, seg.start, length, velocity);
      if (this.opts.arp > 0 && pitches.length > 1) {
        // Upward, like Gesture Synth's arpeggiator; Vibe's own arps accent the first step.
        const step = this.opts.arp;
        for (let i = 0; seg.start + i * step < seg.end - EPS; i++) {
          const at = seg.start + i * step;
          add(pitches[i % pitches.length], at, Math.min(step * 0.95, seg.end - at), velocity * (i % pitches.length === 0 ? 1 : 0.88));
        }
      } else {
        for (const p of pitches) add(p, seg.start, length, velocity);
      }
    }
    const chords = placed.map((s) => s.v.name).filter((n, i, all) => n !== all[i - 1]);
    return { start: clipStart, length: clipEnd - clipStart, notes, chords };
  }
}
