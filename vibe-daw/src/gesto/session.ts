import { create } from 'zustand';
import { ChordReader, type HarmonyMode, type StyleMode } from '@gesto/chordReader';
import { CameraSource } from '@gesto/input/cameraSource';
import { KeyboardSource } from '@gesto/input/keyboardSource';
import { loadKeymap } from '@gesto/input/keymap';
import type { HandFrame } from '@gesto/input/types';
import { currentBeat, liveChord, liveNote, liveRelease, play } from '../engine/api';
import { beatsPerBar, createMidiClip, createTrack } from '../model/project';
import { defaultPresetParams } from '../model/catalog';
import type { Project, Track } from '../model/types';
import { getProject, useDaw, useTransport } from '../state/store';
import { LiveTake, type TakeResult } from './take';
import { gestoKeyFor, sameVoicing, voiceReading, type Voicing } from './voicing';

// Gesto mode in the studio: hands (camera) or keys drive Gesture Synth's chord reader, the
// chords ring live on a track's instrument, and a recording turns them into a MIDI clip.

export interface GestoSettings {
  keyOffset: number;
  harmony: HarmonyMode;
  style: StyleMode;
  octave: number;
  bass: boolean;
  /** Arpeggiator step in beats (0 = held chords). */
  arp: number;
  /** Recording grid in beats (0 = as played). */
  quantize: number;
}

export type GestoInput = 'off' | 'camera' | 'keyboard';

interface GestoState {
  settings: GestoSettings;
  /** Track that plays and receives takes; null until first used. */
  trackId: string | null;
  input: GestoInput;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  chord: string | null;
  volume: number;
  recording: boolean;
  captured: number;
  setSettings: (patch: Partial<GestoSettings>) => void;
}

const SETTINGS_KEY = 'gesto:estudio';
const DEFAULT_PRESET = 'pad';

const ARP_STEPS = [0, 0.5, 0.25, 0.125];
const QUANTIZE_STEPS = [0, 0.25, 0.5, 1, 4];

function loadSettings(): GestoSettings {
  const key = gestoKeyFor(getProject().key);
  const base: GestoSettings = { keyOffset: key.keyOffset, harmony: key.harmony, style: 'fingers', octave: 0, bass: false, arp: 0, quantize: 0.25 };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Record<keyof GestoSettings, unknown>>;
    // Key and harmony follow the song each session; how you like to play is remembered.
    return {
      ...base,
      style: typeof saved.style === 'string' ? (saved.style as StyleMode) : base.style,
      octave: typeof saved.octave === 'number' && Math.abs(saved.octave) <= 2 ? Math.round(saved.octave) : base.octave,
      bass: typeof saved.bass === 'boolean' ? saved.bass : base.bass,
      arp: ARP_STEPS.includes(saved.arp as number) ? (saved.arp as number) : base.arp,
      quantize: QUANTIZE_STEPS.includes(saved.quantize as number) ? (saved.quantize as number) : base.quantize,
    };
  } catch {
    return base;
  }
}

export const useGesto = create<GestoState>((set, get) => ({
  settings: loadSettings(),
  trackId: null,
  input: 'off',
  status: 'idle',
  error: null,
  chord: null,
  volume: 0,
  recording: false,
  captured: 0,
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage disabled */ }
    // A new voicing rule applies at once to whatever is held.
    current = null;
  },
}));

// ---------------------------------------------------------------- target track

export function isPlayable(t: Track | undefined): t is Track {
  return !!t && t.kind === 'instrument' && !!t.instrument;
}

/** The Gesto track, creating a "Gesto" pad track the first time. */
export function ensureTrack(): string {
  const { trackId } = useGesto.getState();
  if (trackId && isPlayable(getProject().tracks.find((t) => t.id === trackId))) return trackId;
  const existing = getProject().tracks.find((t) => isPlayable(t) && t.name.startsWith('Gesto'));
  if (existing) {
    useGesto.setState({ trackId: existing.id });
    return existing.id;
  }
  let id = '';
  useDaw.getState().update('Gesto: add pad track', (d) => {
    const t = createTrack(d, 'instrument', { name: 'Gesto', preset: DEFAULT_PRESET });
    d.tracks.push(t);
    id = t.id;
  });
  useGesto.setState({ trackId: id });
  return id;
}

/** A fresh Gesto track with the default pad, which becomes the target. */
export function newGestoTrack(): string {
  release();
  let id = '';
  useDaw.getState().update('Gesto: add pad track', (d) => {
    const t = createTrack(d, 'instrument', { name: d.tracks.some((x) => x.name === 'Gesto') ? nextGestoName(d) : 'Gesto', preset: DEFAULT_PRESET });
    d.tracks.push(t);
    id = t.id;
  });
  useGesto.setState({ trackId: id });
  return id;
}

export function setTrack(trackId: string) {
  release();
  useGesto.setState({ trackId });
}

export function setPreset(preset: string) {
  const id = ensureTrack();
  release();
  useDaw.getState().update('Gesto: change sound', (d) => {
    const t = d.tracks.find((x) => x.id === id);
    if (t) t.instrument = { preset, params: defaultPresetParams(preset) };
  });
}

// ---------------------------------------------------------------- live loop

const reader = new ChordReader();
const camera = new CameraSource();
const keyboard = new KeyboardSource();
let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;
let raf = 0;
let current: Voicing | null = null;
let sounding: Voicing | null = null;
let arpTimer: ReturnType<typeof setInterval> | null = null;
let take: LiveTake | null = null;
let lastBeat = 0;
let lastFrame: HandFrame | null = null;

/** The latest hands, for the panel's skeleton overlay. */
export function latestFrame(): HandFrame | null {
  return lastFrame;
}

/** The video element the camera feeds; the panel shows it while Gesto is open. */
export function cameraVideo(): HTMLVideoElement {
  if (!video) {
    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.setAttribute('playsinline', '');
  }
  return video;
}

function stopArp() {
  if (arpTimer !== null) clearInterval(arpTimer);
  arpTimer = null;
}

/** Make the track's monitor sound `v` (or nothing). */
function sound(v: Voicing | null) {
  const { trackId, settings } = useGesto.getState();
  stopArp();
  sounding = v;
  if (!trackId) return;
  if (!v) { liveRelease(trackId); return; }
  if (settings.arp > 0 && v.pitches.length > 1) {
    if (v.bass !== null) liveChord(trackId, [v.bass], v.velocity);
    else liveRelease(trackId);
    const stepSec = (60 / getProject().bpm) * settings.arp;
    let i = 0;
    const step = () => {
      liveNote(trackId, v.pitches[i % v.pitches.length], stepSec * 0.95, v.velocity * (i % v.pitches.length === 0 ? 1 : 0.88));
      i++;
    };
    step();
    arpTimer = setInterval(step, stepSec * 1000);
  } else {
    liveChord(trackId, v.bass !== null ? [v.bass, ...v.pitches] : v.pitches, v.velocity);
  }
}

function release() {
  current = null;
  sound(null);
  useGesto.setState({ chord: null, volume: 0 });
}

function onFrame(frame: HandFrame) {
  lastFrame = frame;
  const s = useGesto.getState();
  const reading = reader.read(frame, { harmony: s.settings.harmony, style: s.settings.style });
  const next = reading.playing ? voiceReading(reading, s.settings) : null;

  if (take) {
    const beat = currentBeat();
    // The playhead jumped back: a loop wrapped (or the user rewound).
    if (beat < lastBeat - 0.25) {
      const loop = getProject().loop;
      take.wrap(loop.enabled ? loop.end : lastBeat, loop.enabled ? loop.start : beat);
    }
    lastBeat = beat;
  }

  if (!sameVoicing(current, next)) {
    current = next;
    sound(next);
    if (take) {
      take.set(lastBeat, next);
      useGesto.setState({ captured: take.count });
    }
    useGesto.setState({ chord: next?.name ?? null });
  } else if (!sameVoicing(sounding, current)) {
    sound(current); // settings changed under a held chord
  }
  if (Math.abs(reading.volume - s.volume) > 0.04) useGesto.setState({ volume: reading.playing ? reading.volume : 0 });
}

function loop() {
  const { input } = useGesto.getState();
  if (input === 'camera' && video && video.readyState >= 2) onFrame(camera.getFrame(video, performance.now()));
  else if (input === 'keyboard') onFrame(keyboard.getFrame());
  raf = requestAnimationFrame(loop);
}

// Gesto's keys (1–7, [ ], 8 9 0 -, Shift, arrows) win over studio shortcuts while it is on.
const typing = (e: KeyboardEvent) => typeof HTMLElement !== 'undefined' && e.target instanceof HTMLElement && (e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName));
let gestoKeys = new Set<string>();
const onKey = (down: boolean) => (e: KeyboardEvent) => {
  if (typing(e) || !gestoKeys.has(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  e.stopPropagation();
  if (!e.repeat) keyboard.handleKey(e, down);
};
const keyDown = onKey(true);
const keyUp = onKey(false);

export async function startCamera() {
  if (useGesto.getState().input === 'camera') return;
  stopInput();
  ensureTrack();
  useGesto.setState({ input: 'camera', status: 'loading', error: null });
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser does not give access to the camera.');
    const { initHandTracking, setModelBase } = await import('@gesto/handTracker');
    // The hand model ships with Gesture Synth, served next to the studio at /gesto/.
    setModelBase('/gesto/');
    const tracking = initHandTracking();
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    const v = cameraVideo();
    v.srcObject = stream;
    await v.play().catch(() => undefined);
    await tracking;
    if (useGesto.getState().input !== 'camera') return;
    camera.reset();
    reader.reset();
    useGesto.setState({ status: 'ready' });
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  } catch (e) {
    const denied = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    stopInput();
    useGesto.setState({ status: 'error', error: denied ? 'Camera access was denied. You can play with the keyboard instead.' : `The camera could not start: ${(e as Error).message ?? e}` });
  }
}

export function startKeyboard() {
  if (useGesto.getState().input === 'keyboard') return;
  stopInput();
  ensureTrack();
  keyboard.setKeymap(loadKeymap());
  gestoKeys = new Set(Object.values(loadKeymap()));
  keyboard.reset();
  reader.reset();
  window.addEventListener('keydown', keyDown, true);
  window.addEventListener('keyup', keyUp, true);
  useGesto.setState({ input: 'keyboard', status: 'ready', error: null });
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(loop);
}

export function stopInput() {
  if (useGesto.getState().recording) stopRecording();
  cancelAnimationFrame(raf);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) video.srcObject = null;
  window.removeEventListener('keydown', keyDown, true);
  window.removeEventListener('keyup', keyUp, true);
  lastFrame = null;
  release();
  useGesto.setState({ input: 'off', status: 'idle' });
}

// ---------------------------------------------------------------- recording

export async function startRecording() {
  const s = useGesto.getState();
  if (s.recording || s.input === 'off') return;
  ensureTrack();
  take = new LiveTake({ quantize: s.settings.quantize, arp: s.settings.arp, beatsPerBar: beatsPerBar(getProject()) });
  useGesto.setState({ recording: true, captured: 0 });
  useTransport.setState({ recording: true });
  if (!useTransport.getState().playing) await play();
  lastBeat = currentBeat();
  // A chord already held when recording starts counts from the first beat.
  if (current) take.set(lastBeat, current);
  useGesto.setState({ captured: take.count });
}

/** Stop recording and write the take; returns the new clip's id, if anything was played. */
export function stopRecording(): string | null {
  const t = take;
  take = null;
  useGesto.setState({ recording: false });
  useTransport.setState({ recording: false });
  if (!t) return null;
  const end = useTransport.getState().playing ? currentBeat() : lastBeat;
  const result = t.finish(Math.max(end, lastBeat));
  if (!result) return null;
  return commitTake(result);
}

// Stopping the song ends the take where the playhead stopped.
useTransport.subscribe((s, prev) => {
  if (prev.playing && !s.playing && take) stopRecording();
});

function overlaps(t: Track, start: number, end: number) {
  return t.clips.some((c) => c.start < end - 1e-6 && start < c.start + c.length - 1e-6);
}

function nextGestoName(p: Project): string {
  const used = new Set(p.tracks.map((t) => t.name));
  for (let n = 2; ; n++) if (!used.has(`Gesto ${n}`)) return `Gesto ${n}`;
}

/** Put a take on the Gesto track, or on a fresh one with the same sound if it would overlap a clip. */
export function commitTake(res: TakeResult): string {
  const trackId = ensureTrack();
  let clipId = '';
  let target = trackId;
  useDaw.getState().update('Gesto live take', (d) => {
    let t = d.tracks.find((x) => x.id === trackId);
    if (!t || overlaps(t, res.start, res.start + res.length)) {
      const nt = createTrack(d, 'instrument', { name: nextGestoName(d), preset: t?.instrument?.preset ?? DEFAULT_PRESET });
      if (t?.instrument) nt.instrument = { preset: t.instrument.preset, params: { ...t.instrument.params } };
      d.tracks.push(nt);
      t = nt;
    }
    const names = res.chords.slice(0, 6).join(' ') + (res.chords.length > 6 ? ' …' : '');
    const clip = createMidiClip(d, res.start, res.length, `Gesto · ${names}`);
    clip.notes = res.notes;
    t.clips.push(clip);
    clipId = clip.id;
    target = t.id;
  });
  useDaw.getState().select({ trackId: target, clipIds: [clipId] });
  useDaw.getState().openEditor(clipId);
  return clipId;
}
