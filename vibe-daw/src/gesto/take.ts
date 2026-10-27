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

export interface Bounds { start: number; end: number }

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
  finish(beat: number, bounds?: Bounds): TakeResult | null {
    this.close(beat);
    return this.build(this.segments, bounds);
  }

  /** The take as if it stopped at `beat`, without stopping it (the clip that grows while recording). */
  snapshot(beat: number, bounds?: Bounds): TakeResult | null {
    const segs = [...this.segments];
    if (this.open && beat > this.open.start + EPS) segs.push({ start: this.open.start, end: beat, v: this.open.v });
    return this.build(segs, bounds);
  }

  /** First start and last end of what has been played so far (unquantized), if anything. */
  extent(beat: number): Bounds | null {
    const segs = [...this.segments];
    if (this.open && beat > this.open.start + EPS) segs.push({ start: this.open.start, end: beat, v: this.open.v });
    if (!segs.length) return null;
    return { start: Math.min(...segs.map((s) => s.start)), end: Math.max(...segs.map((s) => s.end)) };
  }

  private placed(segments: Segment[]): Segment[] {
    const q = this.opts.quantize;
    const out: Segment[] = [];
    for (const seg of segments) {
      const start = Math.max(0, this.snap(seg.start));
      let end = this.snap(seg.end);
      // A chord shorter than half a grid step was a passing shape; anything longer keeps one step.
      if (end - start < EPS) {
        if (q > 0 && seg.end - seg.start >= q / 2) end = start + q;
        else if (q > 0) continue;
      }
      if (end - start < EPS) continue;
      out.push({ start, end, v: seg.v });
    }
    return out;
  }

  /** Clip notes for these segments; `bounds` pins the clip (shared with the band's clips). */
  private build(segments: Segment[], bounds?: Bounds): TakeResult | null {
    const placed = this.placed(segments);
    if (!placed.length && !bounds) return null;
    const bpb = this.opts.beatsPerBar;
    const clipStart = bounds ? bounds.start : Math.floor(Math.min(...placed.map((s) => s.start)) / bpb + EPS) * bpb;
    const clipEnd = bounds ? bounds.end : Math.max(clipStart + bpb, Math.ceil(Math.max(...placed.map((s) => s.end)) / bpb - EPS) * bpb);
    const notes: Note[] = [];
    const add = (pitch: number, start: number, duration: number, velocity: number) => {
      const d = Math.min(duration, clipEnd - start);
      if (start >= clipStart - EPS && d > EPS) notes.push({ id: uid(), pitch, start: start - clipStart, duration: d, velocity });
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

// ---------------------------------------------------------------- the band's parts

export interface PartNote { beat: number; pitch: number; duration: number; velocity: number }

/** Drum hits and bass notes exactly as the live band scheduled them, so the clip is what you heard. */
export class PartTake {
  private notes: PartNote[] = [];

  add(n: PartNote): PartNote {
    this.notes.push(n);
    return n;
  }

  extent(): Bounds | null {
    if (!this.notes.length) return null;
    return { start: Math.min(...this.notes.map((n) => n.beat)), end: Math.max(...this.notes.map((n) => n.beat + n.duration)) };
  }

  /** Notes inside the clip, relative to its start. A looped pass that repeats a hit keeps one copy. */
  notesIn(bounds: Bounds, until = Infinity): Note[] {
    const seen = new Set<string>();
    const out: Note[] = [];
    for (const n of this.notes) {
      if (n.beat < bounds.start - EPS || n.beat >= Math.min(bounds.end, until) - EPS) continue;
      const key = `${Math.round(n.beat * 96)}:${n.pitch}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id: uid(), pitch: n.pitch, start: n.beat - bounds.start, duration: Math.max(0.01, Math.min(n.duration, bounds.end - n.beat)), velocity: n.velocity });
    }
    return out;
  }
}
