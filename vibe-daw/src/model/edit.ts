import type { AudioClip, Clip, KeySignature, MidiClip, Note, Project, Track } from './types';
import { mintId, uid } from './project';
import { chordNotes, noteToMidi, snapToKey, voiceLead } from './theory';

// Pure editing operations shared by the UI and the agent's tools.
// Functions that take a Project mutate it (call them inside an immer draft).

export const EPS = 1e-6;

/** Rate at which an audio clip consumes its sample, given the sample's tempo. */
export function audioClipRate(p: Pick<Project, 'bpm'>, clip: AudioClip, sampleBpm?: number): number {
  const tempoRatio = clip.warp !== 'off' && sampleBpm ? p.bpm / sampleBpm : 1;
  return clip.warp === 'stretch' ? tempoRatio : tempoRatio * Math.pow(2, clip.pitch / 12);
}

/**
 * Copy of `clip` restricted to [from, to) in song beats, or null if they don't overlap.
 * MIDI notes are clipped; audio offsets advance so the audio stays in place.
 */
export function sliceClip(p: Project, clip: Clip, from: number, to: number, sampleBpm?: (id: string) => number | undefined): Clip | null {
  const a = Math.max(from, clip.start);
  const b = Math.min(to, clip.start + clip.length);
  if (b - a < EPS) return null;
  const base = { ...clip, id: mintId(p, 'c'), start: a, length: b - a };
  if (clip.type === 'midi') {
    const rel0 = a - clip.start;
    const rel1 = b - clip.start;
    const notes: Note[] = clip.notes
      .filter((n) => n.start + n.duration > rel0 + EPS && n.start < rel1 - EPS)
      .map((n) => ({ ...n, id: uid(), start: Math.max(n.start, rel0) - rel0, duration: Math.min(n.start + n.duration, rel1) - Math.max(n.start, rel0) }));
    return { ...(base as MidiClip), notes };
  }
  const rate = audioClipRate(p, clip, sampleBpm?.(clip.sampleId));
  const skippedSec = ((a - clip.start) * 60) / p.bpm;
  return { ...(base as AudioClip), offset: clip.offset + skippedSec * rate, fadeIn: a > clip.start ? 0.005 : clip.fadeIn };
}

/** Remove everything on `track` within [from, to), splitting clips at the edges. */
export function clearRange(p: Project, track: Track, from: number, to: number, sampleBpm?: (id: string) => number | undefined) {
  const next: Clip[] = [];
  for (const c of track.clips) {
    const end = c.start + c.length;
    if (end <= from + EPS || c.start >= to - EPS) { next.push(c); continue; }
    const left = c.start < from - EPS ? sliceClip(p, c, c.start, from, sampleBpm) : null;
    const right = end > to + EPS ? sliceClip(p, c, to, end, sampleBpm) : null;
    if (left) next.push({ ...left, id: c.id });
    if (right) next.push(right);
  }
  track.clips = next;
}

/** Copy [from, to) of the given tracks to `dest` (overwriting what's there). */
export function copyRange(p: Project, trackIds: string[] | null, from: number, to: number, dest: number, sampleBpm?: (id: string) => number | undefined): number {
  const len = to - from;
  let copied = 0;
  for (const t of p.tracks) {
    if (trackIds && !trackIds.includes(t.id)) continue;
    const pieces = t.clips.map((c) => sliceClip(p, c, from, to, sampleBpm)).filter((c): c is Clip => !!c);
    if (!pieces.length) continue;
    clearRange(p, t, dest, dest + len, sampleBpm);
    for (const piece of pieces) {
      piece.start = piece.start - from + dest;
      t.clips.push(piece);
      copied++;
    }
  }
  return copied;
}

// ---------------------------------------------------------------- drum step patterns

export interface DrumHit { lane: string; beat: number; velocity: number }

/**
 * Parse a step string into hits.
 *  x = hit, X = accent, o = ghost/soft, . or - = rest
 *  2 / 3 / 4 = roll: that many evenly spaced hits inside the step (trap hat rolls)
 *  spaces and | are ignored (use them for readability)
 * The pattern repeats to fill `totalBeats`.
 */
export function parseSteps(lane: string, pattern: string, stepsPerBar: number, beatsPerBar: number, totalBeats: number, baseVelocity = 0.85): DrumHit[] {
  const steps = pattern.replace(/[\s|]/g, '');
  if (!(stepsPerBar > 0) || !Number.isFinite(stepsPerBar) || !(beatsPerBar > 0) || !Number.isFinite(beatsPerBar) || !Number.isFinite(totalBeats)) throw new Error('Pattern timing must be finite and positive.');
  if (!steps.length) return [];
  if (/[^xXo.\-234]/.test(steps)) throw new Error(`Pattern for "${lane}" has unknown characters. Use x X o . and 2/3/4 for rolls.`);
  const stepBeats = beatsPerBar / stepsPerBar;
  const totalSteps = Math.round(totalBeats / stepBeats);
  const hits: DrumHit[] = [];
  for (let i = 0; i < totalSteps; i++) {
    const ch = steps[i % steps.length];
    const beat = i * stepBeats;
    if (ch === 'x') hits.push({ lane, beat, velocity: baseVelocity });
    else if (ch === 'X') hits.push({ lane, beat, velocity: Math.min(1, baseVelocity + 0.15) });
    else if (ch === 'o') hits.push({ lane, beat, velocity: baseVelocity * 0.5 });
    else if (ch === '2' || ch === '3' || ch === '4') {
      const n = Number(ch);
      for (let k = 0; k < n; k++) hits.push({ lane, beat: beat + (k * stepBeats) / n, velocity: baseVelocity * (0.7 + (0.3 * k) / n) });
    }
  }
  return hits;
}

// ---------------------------------------------------------------- melodic writing

export interface NoteInput { pitch: string | number; start: number; duration: number; velocity?: number }

export interface ChordInput {
  chord: string;
  start: number;
  duration: number;
  octave?: number;
  inversion?: number;
  velocity?: number;
  voicing?: 'close' | 'open' | 'drop2' | 'voice_lead';
  /** Spread note starts by this many beats (0.02–0.08 sounds like a guitar strum). */
  strum?: number;
  /** Arpeggiate instead of block chord. */
  arp?: 'up' | 'down' | 'updown' | 'random' | 'pinky' | 'thumb';
  /** Beats per arp step (0.25 = 16ths, 0.5 = 8ths). */
  arp_rate?: number;
  /** Add the chord root an octave below. */
  bass?: boolean;
}

function velOr(v: number | undefined, d: number) {
  return typeof v === 'number' && isFinite(v) ? Math.max(0.05, Math.min(1, v > 1 ? v / 127 : v)) : d;
}

export function buildNotes(notes: NoteInput[] = [], chords: ChordInput[] = []): Note[] {
  const out: Note[] = [];
  for (const n of notes) {
    if (!(n.duration > 0)) continue;
    out.push({ id: uid(), pitch: noteToMidi(n.pitch), start: Math.max(0, n.start), duration: n.duration, velocity: velOr(n.velocity, 0.8) });
  }
  let prev: number[] | null = null;
  for (const c of chords) {
    const octave = c.octave ?? 4;
    let pitches: number[] = c.voicing === 'voice_lead'
      ? voiceLead(prev, c.chord, octave)
      : chordNotes(c.chord, { octave, inversion: c.inversion, spread: c.voicing === 'open' || c.voicing === 'drop2' ? c.voicing : 'close' });
    prev = pitches;
    if (c.bass) pitches = [pitches[0] - 12, ...pitches];
    const vel = velOr(c.velocity, 0.75);
    if (c.arp) {
      const rate = c.arp_rate && c.arp_rate > 0 ? c.arp_rate : 0.5;
      const seq = arpSequence(pitches, c.arp);
      const count = Math.max(1, Math.floor(c.duration / rate + EPS));
      for (let i = 0; i < count; i++) {
        out.push({ id: uid(), pitch: seq[i % seq.length], start: c.start + i * rate, duration: rate * 0.95, velocity: vel * (i % seq.length === 0 ? 1 : 0.88) });
      }
    } else {
      const strum = c.strum ?? 0;
      pitches.forEach((pitch, i) => {
        const offset = strum * i;
        out.push({ id: uid(), pitch, start: c.start + offset, duration: Math.max(0.05, c.duration - offset), velocity: vel * (1 - i * 0.03) });
      });
    }
  }
  return out;
}

function arpSequence(pitches: number[], mode: NonNullable<ChordInput['arp']>): number[] {
  const up = [...pitches].sort((a, b) => a - b);
  switch (mode) {
    case 'up': return up;
    case 'down': return [...up].reverse();
    case 'updown': return up.length > 2 ? [...up, ...up.slice(1, -1).reverse()] : up;
    case 'pinky': return up.flatMap((p, i) => (i === up.length - 1 ? [p] : [p, up[up.length - 1]])).slice(0, Math.max(2, (up.length - 1) * 2));
    case 'thumb': return up.slice(1).flatMap((p) => [up[0], p]);
    case 'random': {
      // deterministic shuffle so re-renders are stable
      const s = [...up];
      for (let i = s.length - 1; i > 0; i--) { const j = (i * 7 + 3) % (i + 1); [s[i], s[j]] = [s[j], s[i]]; }
      return s;
    }
  }
}

/** Repeat notes written in the first `patternBeats` across `totalBeats`. */
export function repeatNotes(notes: Note[], patternBeats: number, totalBeats: number): Note[] {
  if (!(patternBeats > 0) || patternBeats >= totalBeats - EPS) return notes;
  const base = notes.filter((n) => n.start < patternBeats - EPS);
  const out: Note[] = [];
  for (let off = 0; off < totalBeats - EPS; off += patternBeats) {
    for (const n of base) {
      if (n.start + off >= totalBeats - EPS) continue;
      out.push({ ...n, id: uid(), start: n.start + off, duration: Math.min(n.duration, totalBeats - (n.start + off)) });
    }
  }
  return out;
}

// ---------------------------------------------------------------- note transforms

export type NoteOp = 'transpose' | 'octave' | 'quantize' | 'humanize' | 'velocity' | 'scale_velocity' | 'legato' | 'staccato' | 'reverse' | 'snap_to_key' | 'double_time' | 'half_time' | 'invert';

export function transformNotes(clip: MidiClip, op: NoteOp, amount: number | undefined, key: KeySignature): string {
  const notes = clip.notes;
  switch (op) {
    case 'transpose': {
      const st = Math.round(amount ?? 0);
      notes.forEach((n) => { n.pitch = Math.max(0, Math.min(127, n.pitch + st)); });
      return `transposed ${st > 0 ? '+' : ''}${st} semitones`;
    }
    case 'octave': {
      const o = Math.round(amount ?? 1);
      notes.forEach((n) => { n.pitch = Math.max(0, Math.min(127, n.pitch + o * 12)); });
      return `shifted ${o} octave(s)`;
    }
    case 'quantize': {
      const grid = amount && amount > 0 ? amount : 0.25;
      notes.forEach((n) => {
        n.start = Math.round(n.start / grid) * grid;
        n.duration = Math.max(grid / 2, Math.round(n.duration / grid) * grid || grid);
      });
      return `quantized to ${grid} beats`;
    }
    case 'humanize': {
      const amt = amount ?? 0.3;
      let seed = 1;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
      notes.forEach((n) => {
        n.start = Math.max(0, n.start + rnd() * 0.04 * amt);
        n.velocity = Math.max(0.1, Math.min(1, n.velocity + rnd() * 0.3 * amt));
      });
      return `humanized (${amt})`;
    }
    case 'velocity': {
      const v = velOr(amount, 0.8);
      notes.forEach((n) => { n.velocity = v; });
      return `set velocity to ${v}`;
    }
    case 'scale_velocity': {
      const f = amount ?? 1;
      notes.forEach((n) => { n.velocity = Math.max(0.05, Math.min(1, n.velocity * f)); });
      return `scaled velocity ×${f}`;
    }
    case 'legato': {
      const sorted = [...notes].sort((a, b) => a.start - b.start);
      let next = 0;
      for (let i = 0; i < sorted.length; i++) {
        next = Math.max(next, i + 1);
        while (next < sorted.length && sorted[next].start <= sorted[i].start + EPS) next++;
        sorted[i].duration = next < sorted.length ? sorted[next].start - sorted[i].start : Math.max(sorted[i].duration, clip.length - sorted[i].start);
      }
      return 'made legato';
    }
    case 'staccato': {
      const f = amount && amount > 0 && amount < 1 ? amount : 0.4;
      notes.forEach((n) => { n.duration = Math.max(0.05, n.duration * f); });
      return 'shortened notes';
    }
    case 'reverse': {
      notes.forEach((n) => { n.start = Math.max(0, clip.length - n.start - n.duration); });
      return 'reversed in time';
    }
    case 'invert': {
      if (!notes.length) return 'nothing to invert';
      const axis = amount ?? notes[0].pitch;
      notes.forEach((n) => { n.pitch = Math.max(0, Math.min(127, Math.round(2 * axis - n.pitch))); });
      return `inverted around ${axis}`;
    }
    case 'snap_to_key': {
      let moved = 0;
      notes.forEach((n) => { const s = snapToKey(n.pitch, key); if (s !== n.pitch) moved++; n.pitch = s; });
      return `snapped ${moved} note(s) to the key`;
    }
    case 'double_time': {
      notes.forEach((n) => { n.start /= 2; n.duration /= 2; });
      return 'double time';
    }
    case 'half_time': {
      notes.forEach((n) => { n.start *= 2; n.duration *= 2; });
      clip.notes = notes.filter((n) => n.start < clip.length - EPS);
      return 'half time';
    }
  }
}
