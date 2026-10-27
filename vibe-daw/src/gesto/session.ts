import { create } from 'zustand';
import { ChordReader, type HarmonyMode, type StyleMode } from '@gesto/chordReader';
import { CameraSource } from '@gesto/input/cameraSource';
import { KeyboardSource } from '@gesto/input/keyboardSource';
import { loadKeymap } from '@gesto/input/keymap';
import type { HandFrame } from '@gesto/input/types';
import {
  clearLive, currentBeat, liveChord, liveNote, liveRelease, lookAheadSeconds, play, prepareLive,
  scheduleLive, scheduleLiveRelease, stop as stopTransport,
} from '../engine/api';
import { beatsPerBar, createMidiClip, createTrack, defaultDrumLanes } from '../model/project';
import { defaultPresetParams } from '../model/catalog';
import type { Project, Track } from '../model/types';
import { getProject, useDaw, useTransport } from '../state/store';
import { bassRootFor, bassStep, drumHits, GROOVES, stepsToNextBass, type BassStyle, type Groove } from './band';
import { LiveTake, PartTake, type Bounds, type PartNote } from './take';
import { gestoKeyFor, sameVoicing, voiceReading, type Voicing } from './voicing';

// Gesto mode in the studio: hands (camera) or keys drive Gesture Synth's chord reader and the
// chords ring live on a pad track. The live band adds drums and a bass that follows those
// chords, placed on the transport clock. Recording writes all three parts into the
// arrangement while you play: the clips grow bar by bar (muted, since the band and the pad
// monitor are what you hear) and become normal clips when you stop. One undo removes the take.

export interface GestoSettings {
  keyOffset: number;
  harmony: HarmonyMode;
  style: StyleMode;
  octave: number;
  bass: boolean;
  /** Arpeggiator step in beats (0 = held chords). */
  arp: number;
  /** Recording grid in beats for the pads (0 = as played). */
  quantize: number;
  /** Live band: drums and a bass line that follow your chords. */
  band: boolean;
  groove: Groove;
  percussion: boolean;
  bassStyle: BassStyle;
  /** Bass sound; null = the groove's own. */
  bassPreset: string | null;
}

export type GestoInput = 'off' | 'camera' | 'keyboard';
export type GestoPart = 'pads' | 'bass' | 'drums';

interface GestoState {
  settings: GestoSettings;
  /** Pad track that plays and receives takes; null until first used. */
  trackId: string | null;
  bassTrackId: string | null;
  drumTrackId: string | null;
  input: GestoInput;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  chord: string | null;
  volume: number;
  recording: boolean;
  captured: number;
  /** The band is placing notes right now (needs the song playing). */
  bandLive: boolean;
  setSettings: (patch: Partial<GestoSettings>) => void;
}

const SETTINGS_KEY = 'gesto:estudio';
const DEFAULT_PRESET = 'pad';
const ARP_STEPS = [0, 0.5, 0.25, 0.125];
const QUANTIZE_STEPS = [0, 0.25, 0.5, 1, 4];
const GROOVE_IDS: Groove[] = ['off', ...GROOVES.map((g) => g.id)];
const BASS_IDS: BassStyle[] = ['off', 'kick', 'roots', 'octaves', 'walk'];
const NAMES: Record<GestoPart, string> = { pads: 'Gesto', bass: 'Gesto Bass', drums: 'Gesto Drums' };

function loadSettings(): GestoSettings {
  const key = gestoKeyFor(getProject().key);
  const base: GestoSettings = {
    keyOffset: key.keyOffset, harmony: key.harmony, style: 'fingers', octave: 0, bass: false, arp: 0, quantize: 0.25,
    band: false, groove: 'boombap', percussion: false, bassStyle: 'kick', bassPreset: null,
  };
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
      band: typeof saved.band === 'boolean' ? saved.band : base.band,
      groove: GROOVE_IDS.includes(saved.groove as Groove) ? (saved.groove as Groove) : base.groove,
      percussion: typeof saved.percussion === 'boolean' ? saved.percussion : base.percussion,
      bassStyle: BASS_IDS.includes(saved.bassStyle as BassStyle) ? (saved.bassStyle as BassStyle) : base.bassStyle,
      bassPreset: typeof saved.bassPreset === 'string' ? saved.bassPreset : null,
    };
  } catch {
    return base;
  }
}

export const useGesto = create<GestoState>((set, get) => ({
  settings: loadSettings(),
  trackId: null,
  bassTrackId: null,
  drumTrackId: null,
  input: 'off',
  status: 'idle',
  error: null,
  chord: null,
  volume: 0,
  recording: false,
  captured: 0,
  bandLive: false,
  setSettings: (patch) => {
    const before = get().settings;
    const settings = { ...before, ...patch };
    set({ settings });
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage disabled */ }
    // A new voicing rule applies at once to whatever is held.
    current = null;
    if (patch.groove && patch.groove !== before.groove) applyGrooveKit();
    if ('bassPreset' in patch || (patch.groove && !settings.bassPreset)) applyBassSound();
    // New sounds need their monitor voices loaded before the band places more notes.
    if ('bassPreset' in patch || 'groove' in patch) bandReady = false;
    void syncBand();
  },
}));

// ---------------------------------------------------------------- tracks

export function isPlayable(t: Track | undefined): t is Track {
  return !!t && t.kind === 'instrument' && !!t.instrument;
}

const findTrack = (id: string | null) => (id ? getProject().tracks.find((t) => t.id === id) : undefined);
const grooveInfo = () => GROOVES.find((g) => g.id === useGesto.getState().settings.groove) ?? GROOVES[0];
const bassPresetNow = () => useGesto.getState().settings.bassPreset ?? grooveInfo().bassPreset;

function addTrack(part: GestoPart, name: string, like?: Track): string {
  let id = '';
  useDaw.getState().update(`Gesto: add ${part} track`, (d) => {
    const t = part === 'drums'
      ? createTrack(d, 'drums', { name, kit: grooveInfo().kit })
      : createTrack(d, 'instrument', { name, preset: part === 'bass' ? bassPresetNow() : DEFAULT_PRESET });
    if (like?.instrument) t.instrument = { preset: like.instrument.preset, params: { ...like.instrument.params } };
    if (like?.drumLanes) t.drumLanes = like.drumLanes.map((l) => ({ ...l }));
    if (like) { t.effects = like.effects.map((e) => ({ ...e, params: { ...e.params } })); t.volumeDb = like.volumeDb; t.pan = like.pan; }
    d.tracks.push(t);
    id = t.id;
  });
  return id;
}

const STATE_KEY: Record<GestoPart, 'trackId' | 'bassTrackId' | 'drumTrackId'> = { pads: 'trackId', bass: 'bassTrackId', drums: 'drumTrackId' };

/** The track a part plays on, creating it the first time ("Gesto", "Gesto Bass", "Gesto Drums"). */
export function ensurePartTrack(part: GestoPart): string {
  const ok = (t: Track | undefined): t is Track => (part === 'drums' ? t?.kind === 'drums' : isPlayable(t));
  const known = findTrack(useGesto.getState()[STATE_KEY[part]]);
  if (ok(known)) return known.id;
  const existing = getProject().tracks.find((t) => ok(t) && (part === 'pads' ? t.name.startsWith('Gesto') && !/Bass|Drums/.test(t.name) : t.name.startsWith(NAMES[part])));
  const id = existing?.id ?? addTrack(part, NAMES[part]);
  useGesto.setState({ [STATE_KEY[part]]: id } as Partial<GestoState>);
  return id;
}

/** The pad track, creating a "Gesto" pad track the first time. */
export function ensureTrack(): string {
  return ensurePartTrack('pads');
}

function nextName(p: Project, base: string): string {
  const used = new Set(p.tracks.map((t) => t.name));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

/** A fresh pad track with the default pad, which becomes the target. */
export function newGestoTrack(): string {
  release();
  const id = addTrack('pads', nextName(getProject(), 'Gesto'));
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

/** A new groove brings its drum kit to the Gesto drum track. */
function applyGrooveKit() {
  const id = useGesto.getState().drumTrackId;
  if (!findTrack(id)) return;
  useDaw.getState().update('Gesto: change drum kit', (d) => {
    const t = d.tracks.find((x) => x.id === id);
    if (t) t.drumLanes = defaultDrumLanes(d, grooveInfo().kit);
  });
}

function applyBassSound() {
  const id = useGesto.getState().bassTrackId;
  const t = findTrack(id);
  const preset = bassPresetNow();
  if (!isPlayable(t) || t.instrument!.preset === preset) return;
  useDaw.getState().update('Gesto: change bass sound', (d) => {
    const x = d.tracks.find((y) => y.id === id);
    if (x) x.instrument = { preset, params: defaultPresetParams(preset) };
  });
}

// ---------------------------------------------------------------- live pads

const reader = new ChordReader();
const camera = new CameraSource();
const keyboard = new KeyboardSource();
let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;
let raf = 0;
let current: Voicing | null = null;
let sounding: Voicing | null = null;
let arpTimer: ReturnType<typeof setInterval> | null = null;
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

/** Make the pad track's monitor sound `v` (or nothing). */
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
  followPlayhead();

  if (!sameVoicing(current, next)) {
    current = next;
    sound(next);
    if (rec) {
      rec.pads.set(lastBeat, next);
      useGesto.setState({ captured: rec.pads.count });
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
    void syncBand();
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
  void syncBand();
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
  void syncBand();
}

// ---------------------------------------------------------------- playhead

let lastBeat = 0;
/** Loop passes so far: the band counts beats continuously across loop wraps ("virtual" beats). */
let loopOffset = 0;

/** Read the playhead; a jump back is a loop wrap (or a rewind). */
function followPlayhead(): number {
  if (!useTransport.getState().playing) return lastBeat;
  const beat = currentBeat();
  if (beat < lastBeat - 0.25) {
    const loop = getProject().loop;
    const wrapped = loop.enabled && lastBeat >= loop.end - 0.5;
    rec?.pads.wrap(wrapped ? loop.end : lastBeat, wrapped ? loop.start : beat);
    if (wrapped) loopOffset += loop.end - loop.start;
    else resetBand(beat);
  }
  lastBeat = beat;
  return beat;
}

/** Song beat for a virtual (loop-continuous) beat. */
function songBeat(vb: number): number {
  const loop = getProject().loop;
  if (!loop.enabled || vb < loop.end) return vb;
  const len = loop.end - loop.start;
  return len > 0 ? loop.start + ((vb - loop.start) % len) : vb;
}

// ---------------------------------------------------------------- live band

const TICK_MS = 40;
let ticker: ReturnType<typeof setInterval> | null = null;
let nextStep = 0; // next 16th to place, in virtual beats × 4
let bassNow: { root: number; startV: number; untilV: number; note: PartNote | null } | null = null;
let bandReady = false;
let bandPreparing: Promise<void> | null = null;

function resetBand(fromBeat: number) {
  loopOffset = 0;
  nextStep = Math.ceil((fromBeat + guardBeats()) * 4);
  bassNow = null;
}

const guardBeats = () => ((lookAheadSeconds() + 0.03) * getProject().bpm) / 60;

const wantsTicker = () => {
  const s = useGesto.getState();
  return s.input !== 'off' && useTransport.getState().playing && (s.settings.band || s.recording);
};

/** Start or stop the live band and the recording ticker to match the current state. */
export async function syncBand() {
  const s = useGesto.getState();
  const bandOn = s.settings.band && s.input !== 'off' && useTransport.getState().playing;
  if (bandOn && !bandReady) {
    bandPreparing ??= (async () => {
      const ids = [ensurePartTrack('drums'), ensurePartTrack('bass')];
      await prepareLive(ids);
      bandReady = true;
    })().finally(() => { bandPreparing = null; });
    await bandPreparing;
    resetBand(currentBeat());
  }
  if (!bandOn && s.bandLive) {
    clearLive();
    bassNow = null;
    // The pads' monitor was cleared too: bring back what the hands still hold.
    if (current) sound(current);
  }
  useGesto.setState({ bandLive: bandOn && bandReady });
  if (wantsTicker() && ticker === null) {
    lastBeat = currentBeat();
    ticker = setInterval(tick, TICK_MS);
  } else if (!wantsTicker() && ticker !== null) {
    clearInterval(ticker);
    ticker = null;
  }
}

function tick() {
  const now = followPlayhead();
  const s = useGesto.getState();
  if (s.bandLive) placeBand(now + loopOffset);
  if (rec) maybeSnapshot(now);
}

/** Place the band's notes from where it left off up to a little ahead of the playhead. */
function placeBand(nowV: number) {
  const p = getProject();
  const s = useGesto.getState().settings;
  const drumId = useGesto.getState().drumTrackId;
  const bassId = useGesto.getState().bassTrackId;
  const lanes = findTrack(drumId)?.drumLanes ?? [];
  const bpb = beatsPerBar(p);
  const guard = guardBeats();
  // Just past the engine's own look-ahead plus one tick: the bass hears a chord change as soon as it can.
  const horizon = nowV + guard + ((TICK_MS / 1000) * p.bpm) / 60 * 1.5;
  for (; nextStep / 4 < horizon; nextStep++) {
    const vb = nextStep / 4;
    if (vb < nowV + guard) continue; // too close to play on time: skip rather than land late
    const beat = songBeat(vb);
    const bar = Math.floor(beat / bpb + 1e-9);
    const step = Math.round((beat - bar * bpb) * 4);
    const recording = !!rec && vb >= rec.startV;

    if (drumId) {
      for (const hit of drumHits(s.groove, step, bar, lanes, s.percussion)) {
        if (scheduleLive(drumId, beat, hit.note, 0.25, hit.velocity) && recording) rec!.drums.add({ beat, pitch: hit.note, duration: 0.25, velocity: hit.velocity });
      }
    }

    if (bassId && s.bassStyle !== 'off') {
      const root = current ? bassRootFor(current.root) : null;
      const pattern = root !== null ? bassStep(s.bassStyle, s.groove, step) : null;
      const ringing = bassNow && bassNow.untilV > vb + 1e-6;
      const changed = ringing && bassNow!.root !== root;
      if (ringing && (pattern || changed)) {
        // A new note or a new chord cuts the one still ringing, in the clip as on the speakers.
        scheduleLiveRelease(bassId, beat);
        if (bassNow!.note) bassNow!.note.duration = vb - bassNow!.startV;
        bassNow = null;
      }
      const play = pattern ?? (changed && root !== null ? { interval: 0, steps: stepsToNextBass(s.bassStyle, s.groove, step), velocity: 0.85 } : null);
      if (play && root !== null) {
        const len = play.steps / 4;
        const pitch = root + play.interval;
        if (scheduleLive(bassId, beat, pitch, len, play.velocity)) {
          const note = recording ? rec!.bass.add({ beat, pitch, duration: len, velocity: play.velocity }) : null;
          bassNow = { root, startV: vb, untilV: vb + len, note };
        }
      } else if (changed) {
        bassNow = null; // hands down: the bass rests
      }
    }
  }
}

// Start/stop the band with the song.
useTransport.subscribe((s, prev) => {
  if (prev.playing !== s.playing) {
    if (!s.playing) {
      bandReady = false;
      if (rec) stopRecording();
    }
    void syncBand();
  }
});

// ---------------------------------------------------------------- recording

interface Recording {
  pads: LiveTake;
  bass: PartTake;
  drums: PartTake;
  startBeat: number;
  startV: number;
  tracks: Partial<Record<GestoPart, string>>;
  clips: Partial<Record<GestoPart, string>>;
  lastBar: number;
}

let rec: Recording | null = null;

/** Takes go on a track whose clips all end before the take starts; otherwise on a copy of it. */
function recordTarget(part: GestoPart, startBeat: number): string {
  const id = ensurePartTrack(part);
  const t = findTrack(id)!;
  const free = t.clips.every((c) => c.start + c.length <= startBeat + 1e-6);
  return free ? id : addTrack(part, nextName(getProject(), NAMES[part]), t);
}

export async function startRecording() {
  const s = useGesto.getState();
  if (s.recording || s.input === 'off') return;
  const p = getProject();
  const bpb = beatsPerBar(p);
  const at = useTransport.getState().playing ? currentBeat() : useTransport.getState().position;
  const startBeat = at;
  useDaw.getState().beginTransaction('Gesto live take');
  const tracks: Recording['tracks'] = { pads: recordTarget('pads', startBeat) };
  if (s.settings.band && s.settings.groove !== 'off') tracks.drums = recordTarget('drums', startBeat);
  if (s.settings.band && s.settings.bassStyle !== 'off') tracks.bass = recordTarget('bass', startBeat);
  // The band plays on the tracks being recorded.
  useGesto.setState({ trackId: tracks.pads!, ...(tracks.drums ? { drumTrackId: tracks.drums } : {}), ...(tracks.bass ? { bassTrackId: tracks.bass } : {}), recording: true, captured: 0 });
  bandReady = false;
  rec = {
    pads: new LiveTake({ quantize: s.settings.quantize, arp: s.settings.arp, beatsPerBar: bpb }),
    bass: new PartTake(),
    drums: new PartTake(),
    startBeat,
    startV: startBeat,
    tracks,
    clips: {},
    lastBar: Math.floor(startBeat / bpb),
  };
  useTransport.setState({ recording: true });
  if (!useTransport.getState().playing) await play();
  lastBeat = currentBeat();
  loopOffset = 0;
  if (!rec) return;
  rec.startV = lastBeat;
  // A chord already held when recording starts counts from the first beat.
  if (current) rec.pads.set(lastBeat, current);
  useGesto.setState({ captured: rec.pads.count });
  writeTake(rec, lastBeat, false);
  await syncBand();
}

/** Every new bar, the muted clips grow to show what has been recorded so far. */
function maybeSnapshot(beat: number) {
  const bar = Math.floor(beat / beatsPerBar(getProject()));
  if (!rec || bar === rec.lastBar) return;
  rec.lastBar = bar;
  writeTake(rec, beat, false);
}

/** The bar range shared by the three clips: from the take's first bar to the last bar played. */
function takeBounds(r: Recording, beat: number, live: boolean): Bounds {
  const bpb = beatsPerBar(getProject());
  const spans = [r.pads.extent(beat), r.bass.extent(), r.drums.extent(), { start: r.startBeat, end: Math.max(beat, r.startBeat) }].filter((x): x is Bounds => !!x);
  const start = Math.floor(Math.min(...spans.map((x) => x.start)) / bpb + 1e-6) * bpb;
  let end = Math.max(start + bpb, Math.ceil(Math.max(...spans.map((x) => x.end)) / bpb - 1e-6) * bpb);
  // While recording, the clip already covers the bar being played.
  if (live) end = Math.max(end, (Math.floor(beat / bpb + 1e-6) + 1) * bpb);
  return { start, end };
}

function chordsLabel(chords: string[]): string {
  return chords.slice(0, 6).join(' ') + (chords.length > 6 ? ' …' : '');
}

/** Write (or update) the take's clips. Live: muted and growing. Final: audible, empty parts dropped. */
function writeTake(r: Recording, beat: number, final: boolean): string | null {
  const bounds = takeBounds(r, beat, !final);
  const pads = final ? r.pads.finish(beat, bounds) : r.pads.snapshot(beat, bounds);
  const label = chordsLabel(pads?.chords ?? []);
  const parts: Array<[GestoPart, ReturnType<PartTake['notesIn']>, string]> = [
    ['pads', pads?.notes ?? [], label ? `Gesto · ${label}` : 'Gesto'],
    ['bass', r.bass.notesIn(bounds, final ? beat : Infinity), label ? `Bass · ${label}` : 'Bass'],
    ['drums', r.drums.notesIn(bounds, final ? beat : Infinity), `Drums · ${grooveInfo().name}`],
  ];
  useDaw.getState().update('Gesto live take', (d) => {
    for (const [part, notes, name] of parts) {
      const trackId = r.tracks[part];
      const t = trackId && d.tracks.find((x) => x.id === trackId);
      if (!t) continue;
      let clip = t.clips.find((c) => c.id === r.clips[part]);
      if (final && !notes.length) {
        if (clip) t.clips = t.clips.filter((c) => c !== clip);
        continue;
      }
      if (!clip) {
        const fresh = createMidiClip(d, bounds.start, bounds.end - bounds.start, name);
        t.clips.push(fresh);
        r.clips[part] = fresh.id;
        clip = t.clips[t.clips.length - 1];
      }
      if (clip.type !== 'midi') continue;
      clip.start = bounds.start;
      clip.length = bounds.end - bounds.start;
      clip.notes = notes;
      clip.name = final ? name : `● ${name}`;
      clip.muted = !final;
    }
  });
  const alive = new Set(getProject().tracks.flatMap((t) => t.clips.map((c) => c.id)));
  return (['pads', 'bass', 'drums'] as GestoPart[]).map((part) => r.clips[part]).find((id): id is string => !!id && alive.has(id)) ?? null;
}

/** Stop recording, stop the song and keep the take; returns a clip id of it, if anything was played. */
export function stopRecording(): string | null {
  const r = rec;
  if (!r) return null;
  rec = null;
  const end = Math.max(useTransport.getState().playing ? currentBeat() : lastBeat, r.startBeat);
  useGesto.setState({ recording: false });
  useTransport.setState({ recording: false });
  // Stop first: unmuting the clips while playing would make the engine pause and re-chase.
  if (useTransport.getState().playing) stopTransport();
  const keep = writeTake(r, end, true);
  useDaw.getState().endTransaction();
  if (keep) {
    const owner = getProject().tracks.find((t) => t.clips.some((c) => c.id === keep));
    useDaw.getState().select({ trackId: owner?.id ?? null, clipIds: [keep] });
    useDaw.getState().openEditor(keep);
  }
  return keep;
}

/** Play or stop the song without recording: jam with the band. */
export async function toggleJam() {
  if (useTransport.getState().playing) stopTransport();
  else await play();
}
