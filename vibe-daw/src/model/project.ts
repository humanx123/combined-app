import { DRUM_LANE_NOTES, TRACK_COLORS, defaultPresetParams } from './catalog';
import { current, isDraft, type Draft } from 'immer';
import type { AudioClip, Clip, DrumLane, Effect, MidiClip, Project, Track, TrackKind } from './types';

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Mint a short, readable id (t3, c12, fx4) and bump the project counter. Mutates (use inside a draft). */
export function mintId(p: Project, prefix: string): string {
  p.nextId += 1;
  return `${prefix}${p.nextId}`;
}

export function beatsPerBar(p: Pick<Project, 'timeSignature'>): number {
  const [num, den] = p.timeSignature;
  return num * (4 / den);
}

/** 1-based bar number (may be fractional) -> beat position. */
export function barToBeat(p: Pick<Project, 'timeSignature'>, bar: number): number {
  return (bar - 1) * beatsPerBar(p);
}

export function beatToBar(p: Pick<Project, 'timeSignature'>, beat: number): number {
  return beat / beatsPerBar(p) + 1;
}

export function beatsToSeconds(p: Pick<Project, 'bpm'>, beats: number): number {
  return (beats * 60) / p.bpm;
}

export function secondsToBeats(p: Pick<Project, 'bpm'>, seconds: number): number {
  return (seconds * p.bpm) / 60;
}

/** Format a beat position as "bar.beat.sixteenth", 1-based like every DAW. */
export function formatPosition(p: Pick<Project, 'timeSignature'>, beat: number): string {
  const bpb = beatsPerBar(p);
  const bar = Math.floor(beat / bpb) + 1;
  const inBar = beat - (bar - 1) * bpb;
  const b = Math.floor(inBar) + 1;
  const six = Math.floor((inBar - Math.floor(inBar)) * 4) + 1;
  return `${bar}.${b}.${six}`;
}

/** Song end in beats: last clip end, at least 8 bars. */
export function projectLength(p: Project): number {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.length);
  for (const s of p.sections) end = Math.max(end, s.start + s.length);
  return Math.max(end, beatsPerBar(p) * 8);
}

export function createProject(name = 'Untitled beat'): Project {
  const now = Date.now();
  return {
    id: uid(),
    name,
    schemaVersion: 1,
    bpm: 140,
    timeSignature: [4, 4],
    key: { root: 'C', scale: 'minor' },
    swing: 0,
    tracks: [],
    sections: [],
    annotations: [],
    loop: { enabled: false, start: 0, end: 16 },
    master: {
      volumeDb: 0,
      effects: [{ id: 'fx0', type: 'limiter', enabled: true, params: { threshold: -1 } }],
    },
    nextId: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function nextTrackColor(p: Project): string {
  const used = new Set(p.tracks.map((t) => t.color));
  return TRACK_COLORS.find((c) => !used.has(c)) ?? TRACK_COLORS[p.tracks.length % TRACK_COLORS.length];
}

/** Default kit lanes, wired to the procedurally designed built-in samples. */
export function defaultDrumLanes(p: Project, style: 'trap' | 'boombap' | 'lofi' | 'house' | 'drill' = 'trap'): DrumLane[] {
  const kits: Record<string, Array<[string, string]>> = {
    trap: [['kick', 'b-kick-punchy'], ['snare', 'b-snare-trap'], ['clap', 'b-clap-wide'], ['hat', 'b-hat-tight'], ['openhat', 'b-openhat'], ['perc', 'b-perc-rim'], ['crash', 'b-crash']],
    drill: [['kick', 'b-kick-hard'], ['snare', 'b-snare-crack'], ['clap', 'b-clap-wide'], ['hat', 'b-hat-tight'], ['openhat', 'b-openhat'], ['perc', 'b-perc-rim'], ['crash', 'b-crash']],
    boombap: [['kick', 'b-kick-dusty'], ['snare', 'b-snare-dusty'], ['hat', 'b-hat-dusty'], ['openhat', 'b-openhat'], ['rim', 'b-perc-rim'], ['shaker', 'b-shaker']],
    lofi: [['kick', 'b-kick-dusty'], ['snare', 'b-snare-dusty'], ['hat', 'b-hat-dusty'], ['rim', 'b-perc-rim'], ['shaker', 'b-shaker']],
    house: [['kick', 'b-kick-house'], ['clap', 'b-clap-wide'], ['hat', 'b-hat-tight'], ['openhat', 'b-openhat'], ['perc', 'b-perc-conga'], ['ride', 'b-ride']],
  };
  return kits[style].map(([name, sampleId]) => ({
    id: mintId(p, 'ln'),
    name,
    note: DRUM_LANE_NOTES[name] ?? 60,
    sampleId,
    gainDb: name === 'hat' ? -4 : name === 'openhat' ? -6 : name === 'crash' ? -8 : 0,
    pitch: 0,
    choke: name === 'hat' || name === 'openhat' ? 1 : undefined,
  }));
}

export function createTrack(
  p: Project,
  kind: TrackKind,
  opts: { name?: string; preset?: string; color?: string; kit?: 'trap' | 'boombap' | 'lofi' | 'house' | 'drill' } = {},
): Track {
  const id = mintId(p, 't');
  const preset = opts.preset ?? (kind === 'instrument' ? 'piano' : undefined);
  return {
    id,
    name: opts.name ?? (kind === 'drums' ? 'Drums' : kind === 'audio' ? 'Audio' : presetLabel(preset)),
    kind,
    color: opts.color ?? nextTrackColor(p),
    volumeDb: kind === 'drums' ? -2 : -6,
    pan: 0,
    mute: false,
    solo: false,
    instrument: kind === 'instrument' && preset ? { preset, params: defaultPresetParams(preset) } : undefined,
    drumLanes: kind === 'drums' ? defaultDrumLanes(p, opts.kit ?? 'trap') : undefined,
    effects: [],
    clips: [],
  };
}

function presetLabel(preset?: string): string {
  if (!preset) return 'Instrument';
  return preset.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function createMidiClip(p: Project, start: number, length: number, name = 'Pattern'): MidiClip {
  return { id: mintId(p, 'c'), type: 'midi', name, start, length, notes: [] };
}

export function createAudioClip(p: Project, sampleId: string, start: number, length: number, name = 'Audio'): AudioClip {
  return {
    id: mintId(p, 'c'), type: 'audio', name, start, length, sampleId,
    offset: 0, gainDb: 0, pitch: 0, loop: false, warp: 'off', reverse: false, fadeIn: 0, fadeOut: 0.01,
  };
}

export function findTrack(p: Project, trackId: string): Track | undefined {
  return p.tracks.find((t) => t.id === trackId);
}

export function findClip(p: Project, clipId: string): { track: Track; clip: Clip } | undefined {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return undefined;
}

export function findEffect(p: Project, effectId: string): { owner: Track | 'master'; effect: Effect; list: Effect[] } | undefined {
  const m = p.master.effects.find((e) => e.id === effectId);
  if (m) return { owner: 'master', effect: m, list: p.master.effects };
  for (const t of p.tracks) {
    const e = t.effects.find((x) => x.id === effectId);
    if (e) return { owner: t, effect: e, list: t.effects };
  }
  return undefined;
}

/** True if any track is soloed and this one isn't - i.e. it should be silent. */
export function isSilencedBySolo(p: Project, t: Track): boolean {
  return p.tracks.some((x) => x.solo) && !t.solo;
}

export function cloneDeep<T>(v: T): T {
  return structuredClone(isDraft(v) ? current(v as Draft<T>) : v) as T;
}
