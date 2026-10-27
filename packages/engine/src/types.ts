/**
 * Shared type definitions for the combined gesture-DAW platform.
 *
 * These types form the contract between the gesture synthesizer, the DAW
 * engine, and the AI assistant. They are intentionally minimal and composable
 * so that both the gesture synth (deliberately minimal scope) and the full
 * Vibe DAW can consume them without pulling in each other's dependencies.
 */

// ─── Audio primitives ────────────────────────────────────────────────────────

/** A musical note expressed as a MIDI number (0-127). */
export type MidiNote = number;

/** A frequency in Hertz. */
export type Frequency = number;

/** Velocity / amplitude in 0-1 range. */
export type Velocity = number;

/** A time in seconds relative to the audio context clock. */
export type Seconds = number;

/** A time in beats (quarter notes) relative to the project tempo. */
export type Beats = number;

// ─── Project model ───────────────────────────────────────────────────────────

/** A single track in the arrangement. */
export interface Track {
  id: string;
  name: string;
  instrumentId: string;
  muted: boolean;
  solo: boolean;
  volume: number; // 0-1, relative to master
  pan: number; // -1 to 1
  clips: Clip[];
}

/** A clip of audio or MIDI data placed on a track. */
export interface Clip {
  id: string;
  trackId: string;
  start: Beats;
  duration: Beats;
  type: 'audio' | 'midi';
  notes?: MidiNote[];
  audioBuffer?: AudioBuffer;
}

/** The top-level project document. */
export interface Project {
  id: string;
  name: string;
  version: number;
  tempo: number; // BPM
  timeSignature: [number, number];
  tracks: Track[];
  masterVolume: number;
  createdAt: number;
  updatedAt: number;
}

// ─── Gesture model ───────────────────────────────────────────────────────────

/** A single detected hand landmark from MediaPipe. */
export interface Landmark {
  x: number; // 0-1, normalized
  y: number; // 0-1, normalized
  z: number; // depth, normalized
}

/** A snapshot of both hands at a point in time. */
export interface HandFrame {
  timestamp: number;
  leftHand: Landmark[] | null;
  rightHand: Landmark[] | null;
  presence: {
    left: boolean;
    right: boolean;
  };
}

/** Recognized musical gesture from a hand frame. */
export interface GestureEvent {
  source: 'gesture' | 'keyboard' | 'midi';
  note?: MidiNote;
  velocity?: Velocity;
  duration?: Seconds;
  chord?: {
    root: MidiNote;
    degrees: number[];
    quality: 'major' | 'minor' | 'diminished' | 'augmented' | '7th' | '9th';
  };
  expression: {
    volume: number;
    filter: number;
    octave: number;
  };
  timestamp: number;
}

// ─── Instrument & effect model ───────────────────────────────────────────────

/** A synthesizer preset. */
export interface InstrumentPreset {
  id: string;
  name: string;
  type: 'sawtooth' | 'square' | 'triangle' | 'sine' | 'fm' | 'sample';
  params: Record<string, number>;
}

/** An effect instance in the audio graph. */
export interface EffectInstance {
  id: string;
  type: string;
  params: Record<string, number>;
  enabled: boolean;
}

// ─── AI / agent model ────────────────────────────────────────────────────────

/** A suggestion returned by the AI assistant. */
export interface Suggestion {
  id: string;
  type: 'arrangement' | 'instrument' | 'effect' | 'mix' | 'sound-design';
  description: string;
  confidence: number; // 0-1
  actionable: boolean;
  data?: Record<string, unknown>;
}

/** A reference track used for AI analysis. */
export interface ReferenceTrack {
  id: string;
  name: string;
  audioBuffer: AudioBuffer;
  analyzedAt?: number;
  analysis?: {
    tempo: number;
    key: string;
    energy: number;
    brightness: number;
  };
}

// ─── State model ─────────────────────────────────────────────────────────────

/** The combined application state. */
export interface CombinedState {
  project: Project;
  currentView: 'gesture' | 'piano' | 'mixer' | 'ai';
  gestureMode: 'recording' | 'playing' | 'disabled';
  inputMode: 'gesture' | 'keyboard' | 'midi';
  aiInstructions: string;
  suggestions: Suggestion[];
  referenceTracks: ReferenceTrack[];
  checkpoints: Checkpoint[];
  undoHistory: HistoryEntry[];
  gestureEvents: GestureEvent[];
}

/** A saved checkpoint for undo/redo. */
export interface Checkpoint {
  id: string;
  timestamp: number;
  project: Project;
  description: string;
}

/** An entry in the undo history. */
export interface HistoryEntry {
  id: string;
  timestamp: number;
  type: 'add' | 'remove' | 'modify';
  description: string;
  before: Project;
  after: Project;
}

// ─── Utility types ───────────────────────────────────────────────────────────

/** A result type for operations that can fail. */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** A function that can be called to unsubscribe. */
export type Unsubscribe = () => void;