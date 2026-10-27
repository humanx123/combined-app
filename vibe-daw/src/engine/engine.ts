import * as Tone from 'tone';
import { useDaw, useTransport, getProject } from '../state/store';
import { useSettings } from '../state/settings';
import { EngineGraph, preloadProject } from './graph';
import { contextLock } from './lock';
import { configureFreeze, scheduleFreeze } from './freeze';
import type { Project } from '../model/types';
import { renderSamplePreview } from './samplePreview';
import { pcmToAudioBuffer } from './wav';
import { nativeAudioContext, resumeAudioContext } from './unlock';
import { useLibrary } from '../samples/library';

// Live playback engine: one EngineGraph on the realtime AudioContext, kept in sync
// with the store. Everything here captures the realtime context/transport once,
// because offline renders temporarily swap Tone's global context.

let graph: EngineGraph | null = null;
let transport: ReturnType<typeof Tone.getTransport> | null = null;
let realtimeContext: Tone.Context | null = null;
let syncRunning = false;
let syncError: unknown = null;
let playRequest = 0;
let starting = false;
let previewRequest = 0;
let syncing: Promise<void> = Promise.resolve();
let pending: Project | null = null;
let syncedProject: Project | null = null;
let raf = 0;
let previewSrc: Tone.Player | null = null;
let loadingListeners: Array<(loading: boolean) => void> = [];

export function onEngineLoading(fn: (loading: boolean) => void) {
  loadingListeners.push(fn);
  return () => { loadingListeners = loadingListeners.filter((f) => f !== fn); };
}

function setLoading(v: boolean) {
  loadingListeners.forEach((f) => f(v));
}

/** Create the graph (no audio yet - browsers need a gesture before the context runs). */
export function initEngine() {
  if (graph) return;
  // A larger output buffer ('playback') trades a few ms of latency for no dropouts
  // with heavy projects; a DAW's transport doesn't need game-level latency.
  const low = useSettings.getState().latency === 'low';
  // Wrap the context the gesture handlers already unlocked (see unlock.ts).
  realtimeContext = new Tone.Context({ context: nativeAudioContext(), latencyHint: low ? 'interactive' : 'playback', lookAhead: low ? 0.06 : 0.12 });
  Tone.setContext(realtimeContext, true);
  transport = Tone.getTransport();
  graph = new EngineGraph({ live: true });
  graph.setMetronome(useTransport.getState().metronome);
  // Install completed freezes on the next playback/update rather than repeatedly
  // switching sounding tracks between live and frozen in the middle of a listen.
  configureFreeze(Tone.getContext().sampleRate, () => {
    if (!useTransport.getState().playing) queueSync(getProject());
  });
  queueSync(getProject());
  useDaw.subscribe((s, prev) => {
    if (s.project !== prev.project) {
      if (s.project.id !== prev.project.id) stop(true);
      const p = s.project, old = prev.project;
      // Text-only cues, section names and project metadata do not touch playback.
      if (p.id !== old.id || p.bpm !== old.bpm || p.swing !== old.swing || p.timeSignature !== old.timeSignature || p.tracks !== old.tracks || p.master !== old.master || p.loop !== old.loop) queueSync(p);
    }
  });
  useTransport.subscribe((s, prev) => {
    if (s.metronome !== prev.metronome) graph?.setMetronome(s.metronome);
  });
  useLibrary.subscribe((s, prev) => {
    if (s.samples !== prev.samples) queueSync(getProject());
  });
}

function queueSync(p: Project) {
  pending = p;
  if (syncRunning) return;
  syncRunning = true;
  syncing = Promise.resolve().then(async () => {
    let held: { beat: number; request: number } | null = null;
    setLoading(true);
    try {
      while (pending && graph) {
        const next = pending;
        pending = null;
        try {
          const assets = await preloadProject(next);
          if (pending) continue; // A newer edit superseded this load.
          const applied = await contextLock.run(async () => {
            if (pending) return false; // An edit may also arrive while waiting for the lock.
            if (!held && transport?.state === 'started' && useTransport.getState().playing && needsPlaybackHold(syncedProject, next)) {
              const at = realtimeContext!.immediate();
              held = { beat: transport.getTicksAtTime(at) / transport.PPQ, request: playRequest };
              // Pause now, before disposing/rescheduling any sounding nodes. The
              // transport's pause event releases voices; resume chases the new notes.
              transport.pause(at);
              useTransport.getState().setPosition(held.beat);
            }
            await graph!.sync(next, assets, !held && useTransport.getState().playing);
            syncedProject = next;
            return true;
          });
          if (!applied) continue;
          syncError = null;
          scheduleFreeze(next);
        } catch (e) {
          syncError = e;
          console.error('Engine sync failed', e);
        }
      }
    } finally {
      syncRunning = false;
      // A stop, pause, seek, or explicit play issued during an async graph update
      // owns the transport. Never override it with an automatic resume.
      const resume = held as { beat: number; request: number } | null;
      if (resume && resume.request === playRequest && useTransport.getState().playing) {
        if (syncError) useTransport.getState().setPlaying(false);
        else if (transport) {
          transport.ticks = Math.round(resume.beat * transport.PPQ);
          transport.start('+0.05');
          startPlayheadLoop();
        }
      }
      setLoading(false);
    }
  });
}

/** Mixer controls stay live; changes that rebuild nodes/events need a short hold. */
function needsPlaybackHold(before: Project | null, after: Project): boolean {
  if (!before || before.bpm !== after.bpm || before.swing !== after.swing || before.timeSignature !== after.timeSignature || before.loop !== after.loop || before.master.effects !== after.master.effects || before.tracks.length !== after.tracks.length) return true;
  return after.tracks.some((t, i) => {
    const old = before.tracks[i];
    return old.id !== t.id || old.kind !== t.kind || old.instrument !== t.instrument || old.drumLanes !== t.drumLanes || old.clips !== t.clips || old.effects !== t.effects;
  });
}

/** Wait until the audio graph reflects the latest project. */
export async function engineSettled(): Promise<void> {
  let last: Promise<void> | null = null;
  while (last !== syncing) {
    last = syncing;
    await syncing;
  }
  if (syncError) throw syncError;
}

export async function ensureAudio() {
  // Offline rendering may currently own Tone's global context.
  if (realtimeContext) await resumeAudioContext(realtimeContext);
}

export async function play(fromBeat?: number) {
  const request = ++playRequest;
  starting = true;
  useTransport.getState().setStarting(true);
  try {
  await ensureAudio();
  // An in-flight sync already includes current edits. Requeueing the same project
  // here supersedes its asset load and can force failed downloads to start again.
  if (!syncRunning) queueSync(getProject()); // Pick up completed freezes when idle.
  await engineSettled();
  if (!transport || request !== playRequest) return;
  const t = transport;
  const at = Math.max(0, fromBeat ?? useTransport.getState().position);
  t.stop();
  graph?.panic();
  t.ticks = Math.round(at * t.PPQ);
  t.start('+0.05');
  useTransport.getState().setPlaying(true);
  startPlayheadLoop();
  } finally {
    if (request === playRequest) { starting = false; useTransport.getState().setStarting(false); }
  }
}

export function stop(rewind = false) {
  ++playRequest;
  starting = false;
  useTransport.getState().setStarting(false);
  transport?.stop();
  graph?.panic();
  useTransport.getState().setPlaying(false);
  cancelAnimationFrame(raf);
  if (rewind) {
    const loop = getProject().loop;
    useTransport.getState().setPosition(loop.enabled ? loop.start : 0);
  }
}

export function pause() {
  ++playRequest;
  starting = false;
  useTransport.getState().setStarting(false);
  if (!transport) return;
  const at = realtimeContext!.immediate();
  const pos = transport.getTicksAtTime(at) / transport.PPQ;
  transport.pause(at);
  graph?.panic();
  useTransport.getState().setPlaying(false);
  useTransport.getState().setPosition(pos);
  cancelAnimationFrame(raf);
}

export async function togglePlay() {
  if (starting || useTransport.getState().playing) pause();
  else await play();
}

export function seek(beat: number) {
  const b = Number.isFinite(beat) ? Math.max(0, beat) : 0;
  useTransport.getState().setPosition(b);
  if (transport && useTransport.getState().playing) {
    void play(b);
  }
}

function startPlayheadLoop() {
  cancelAnimationFrame(raf);
  const tick = () => {
    if (!transport || !useTransport.getState().playing) return;
    // Keep looping while we're playing: the transport starts slightly in the future,
    // so its state reads 'stopped' for the first frames.
    if (transport.state === 'started') useTransport.getState().setPosition(transport.getTicksAtTime(realtimeContext!.immediate()) / transport.PPQ);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export function previewNote(trackId: string, midi: number, velocity = 0.8) {
  void ensureAudio().then(engineSettled).then(() => graph?.previewNote(trackId, midi, velocity)).catch((e) => console.warn('Preview failed', e));
}

// Gesto Studio: chords played by hand. A request number per track keeps a slow first load
// (instrument samples) from sounding a chord the player already let go of.
const liveRequests = new Map<string, number>();
const bumpLive = (trackId: string) => { const n = (liveRequests.get(trackId) ?? 0) + 1; liveRequests.set(trackId, n); return n; };

export function liveChord(trackId: string, midis: number[], velocity: number) {
  const n = bumpLive(trackId);
  const wanted = () => liveRequests.get(trackId) === n;
  void ensureAudio().then(engineSettled).then(() => (wanted() ? graph?.liveChord(trackId, midis, velocity, wanted) : undefined)).catch((e) => console.warn('Live chord failed', e));
}

export function liveNote(trackId: string, midi: number, durSec: number, velocity: number) {
  const n = liveRequests.get(trackId) ?? 0;
  const wanted = () => (liveRequests.get(trackId) ?? 0) === n;
  void ensureAudio().then(engineSettled).then(() => (wanted() ? graph?.liveNote(trackId, midi, durSec, velocity, wanted) : undefined)).catch((e) => console.warn('Live note failed', e));
}

export function liveRelease(trackId: string) {
  bumpLive(trackId);
  graph?.liveRelease(trackId);
}

/** Song position right now in beats: exact while playing, unlike the 60 fps playhead. */
export function currentBeat(): number {
  if (transport && realtimeContext && useTransport.getState().playing && transport.state === 'started') {
    return transport.getTicksAtTime(realtimeContext.immediate()) / transport.PPQ;
  }
  return useTransport.getState().position;
}

/** Audition a library sample through the master bus. */
export async function previewSample(sampleId: string) {
  stopPreview();
  const request = previewRequest;
  await ensureAudio();
  const { pcm } = await renderSamplePreview(getProject(), sampleId);
  if (request !== previewRequest) return;
  const buf = pcmToAudioBuffer(pcm);
  await contextLock.run(() => {
    if (request !== previewRequest || !realtimeContext) return;
    previewSrc = new Tone.Player({ context: realtimeContext, url: buf, volume: 0 });
    previewSrc.connect(realtimeContext.destination);
    const current = previewSrc;
    current.onstop = () => { if (previewSrc === current) previewSrc = null; current.dispose(); };
    current.start();
  });
}

export function stopPreview() {
  ++previewRequest;
  previewSrc?.stop();
  previewSrc?.dispose();
  previewSrc = null;
}

export function getMasterLevels(): number[] {
  return graph?.masterLevel() ?? [-Infinity, -Infinity];
}

export function getTrackLevel(trackId: string): number {
  return graph?.trackLevel(trackId) ?? -Infinity;
}

export function getSpectrum(): Float32Array | null {
  const v = graph?.analyser?.getValue();
  return v instanceof Float32Array ? v : null;
}
