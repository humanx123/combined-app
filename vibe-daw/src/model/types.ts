// Core project document. Everything the user and the agent edit lives here.
// Time is measured in beats (quarter notes) from the start of the song, 0-based.
// The agent API speaks 1-based bars; conversion happens at the tool boundary.

export type PitchClass = 'C' | 'C#' | 'D' | 'D#' | 'E' | 'F' | 'F#' | 'G' | 'G#' | 'A' | 'A#' | 'B';

export type ScaleName =
  | 'major'
  | 'minor'
  | 'harmonic_minor'
  | 'melodic_minor'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'locrian'
  | 'pentatonic_major'
  | 'pentatonic_minor'
  | 'blues';

export interface KeySignature {
  root: PitchClass;
  scale: ScaleName;
}

export interface Note {
  id: string;
  /** MIDI note number, 0-127. On drum tracks this selects the lane via DrumLane.note. */
  pitch: number;
  /** Beats relative to clip start. */
  start: number;
  /** Beats. */
  duration: number;
  /** 0..1 */
  velocity: number;
}

interface ClipBase {
  id: string;
  name: string;
  /** Beats from song start. */
  start: number;
  /** Beats. */
  length: number;
  muted?: boolean;
  /** Set when the agent created/changed it and the user hasn't reviewed it yet. */
  aiPending?: boolean;
}

export interface MidiClip extends ClipBase {
  type: 'midi';
  notes: Note[];
}

export type WarpMode = 'off' | 'resample' | 'stretch';

export interface AudioClip extends ClipBase {
  type: 'audio';
  sampleId: string;
  /** Seconds into the source sample where playback begins. */
  offset: number;
  gainDb: number;
  /** Semitones. With warp 'resample' this is combined into the playback rate. */
  pitch: number;
  /** Loop the sample to fill the clip. */
  loop: boolean;
  /** How to fit the sample's native tempo to the project tempo. */
  warp: WarpMode;
  reverse: boolean;
  /** Seconds. */
  fadeIn: number;
  fadeOut: number;
}

export type Clip = MidiClip | AudioClip;

export type TrackKind = 'instrument' | 'drums' | 'audio';

export interface InstrumentSpec {
  preset: string;
  /** Preset-specific overrides, e.g. { attack: 0.3, cutoff: 1200, glide: 0.05 }. */
  params: Record<string, number>;
}

export interface DrumLane {
  id: string;
  /** Short role name the agent and step editor use: kick, snare, clap, hat, openhat, perc, rim, crash, fx... */
  name: string;
  /** MIDI note this lane responds to. */
  note: number;
  sampleId: string;
  gainDb: number;
  /** Semitones */
  pitch: number;
  /** Lanes in the same choke group cut each other off (closed hat chokes open hat). */
  choke?: number;
}

export type EffectType =
  | 'eq'
  | 'parametric_eq'
  | 'filter'
  | 'compressor'
  | 'reverb'
  | 'delay'
  | 'distortion'
  | 'saturation'
  | 'bitcrusher'
  | 'chorus'
  | 'phaser'
  | 'tremolo'
  | 'widener'
  | 'lofi'
  | 'limiter'
  | 'duck'
  | 'custom';

/** One knob on a custom effect. Its value lives in Effect.params under `id`. */
export interface CustomEffectParam {
  id: string;
  label: string;
  min: number;
  max: number;
  default: number;
}

/** A user- or Producer-written effect: DSP code that runs on the audio thread, plus its knobs. */
export interface CustomEffectDef {
  name: string;
  description?: string;
  /** Defines `function process(left, right, params, info)`; see model/customEffect.ts. */
  code: string;
  params: CustomEffectParam[];
}

export interface Effect {
  id: string;
  type: EffectType;
  enabled: boolean;
  params: Record<string, number | string>;
  /** Only on type 'custom': travels with the project so it renders anywhere. */
  custom?: CustomEffectDef;
}

export interface Track {
  id: string;
  name: string;
  kind: TrackKind;
  color: string;
  volumeDb: number;
  /** -1..1 */
  pan: number;
  mute: boolean;
  solo: boolean;
  instrument?: InstrumentSpec;
  drumLanes?: DrumLane[];
  effects: Effect[];
  clips: Clip[];
}

export interface Section {
  id: string;
  name: string;
  /** Beats */
  start: number;
  /** Beats */
  length: number;
}

export interface Annotation {
  id: string;
  kind: 'note' | 'lyric';
  text: string;
  /** Song beats, independent of audio or vocal tracks. */
  start: number;
  length: number;
  trackId?: string;
  author: 'user' | 'producer';
  resolved?: boolean;
  aiPending?: boolean;
}

export interface Project {
  id: string;
  name: string;
  schemaVersion: 1;
  bpm: number;
  timeSignature: [number, number];
  key: KeySignature;
  /** 0..1, applied to off-beat 16ths. */
  swing: number;
  tracks: Track[];
  sections: Section[];
  annotations?: Annotation[];
  loop: { enabled: boolean; start: number; end: number };
  master: { volumeDb: number; effects: Effect[] };
  /** Monotonic counter used to mint short, agent-friendly ids (t3, c12, fx4). */
  nextId: number;
  createdAt: number;
  updatedAt: number;
}

export type SampleSource = 'builtin' | 'user' | 'generated' | 'designed' | 'online';

export interface SampleMeta {
  id: string;
  name: string;
  /** kick, snare, clap, hat, openhat, perc, rim, crash, 808, bass, fx, texture, guitar, keys, vocal, loop, melody... */
  category: string;
  kind: 'oneshot' | 'loop';
  tags: string[];
  source: SampleSource;
  /** Seconds */
  duration: number;
  bpm?: number;
  key?: string;
  /** For pitched one-shots: MIDI note of the fundamental. */
  rootNote?: number;
  /** What the agent heard when it auditioned this sample. Cached so it doesn't re-listen. */
  aiDescription?: string;
  /** Listening format used for the cached description. */
  aiDescriptionAudio?: string;
  aiDescriptionContext?: string;
  /** Prompt used to generate it, if generated. */
  prompt?: string;
  createdAt: number;
  /** Cloud storage path when synced. */
  storagePath?: string;
  attribution?: { sourceUrl: string; license: string; licenseUrl: string; author: string };
}
