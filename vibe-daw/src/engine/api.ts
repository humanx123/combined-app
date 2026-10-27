import { useTransport } from '../state/store';
import type { Project } from '../model/types';
import type { RenderOptions } from './render';
import type { ExportFormat } from './exportFormats';
import type { PcmData } from './wav';
import { contextLock } from './lock';
import { unlockAudio, unlockAudioOnGestures } from './unlock';
import {haptic} from '../native/native-haptics';

// Everything outside src/engine talks to audio through this file. It never imports
// Tone directly: Tone creates an AudioContext the moment it's imported, and browsers
// warn (and keep it suspended) unless that happens after a click or key press.
// So the engine loads on the first user gesture, or on demand.

type EngineModule = typeof import('./engine');
let engine: EngineModule | null = null;
let loading: Promise<EngineModule> | null = null;
let playRequest = 0;

export function loadEngine(): Promise<EngineModule> {
  // initEngine captures Tone's global context, so it must not run while an offline
  // bounce has swapped that context out.
  loading ??= import('./engine').then((m) => contextLock.run(() => {
    m.initEngine();
    engine = m;
    return m;
  })).catch((e) => { loading = null; throw e; });
  return loading;
}

/** Unlock audio on every user interaction, and load the engine on the first one. */
export function loadEngineOnFirstGesture() {
  unlockAudioOnGestures(() => void loadEngine().catch((e) => console.warn('Audio engine could not load', e)));
}

export async function play(fromBeat?: number) {
  const request = ++playRequest;
  useTransport.getState().setStarting(true);
  try {
    unlockAudio(); // Before the lazy import/lock can consume the browser gesture.
    const loaded = await loadEngine();
    if (request !== playRequest) return;
    await loaded.play(fromBeat);
    haptic('press');
  } finally { if (request === playRequest) useTransport.getState().setStarting(false); }
}

export function stop(rewind = false) {
  if(useTransport.getState().playing || useTransport.getState().starting)haptic('selection');
  ++playRequest;
  useTransport.getState().setStarting(false);
  if (engine) engine.stop(rewind);
  else if (rewind) useTransport.getState().setPosition(0);
}

export async function togglePlay() {
  if (useTransport.getState().starting) stop();
  else if (useTransport.getState().playing) {await (await loadEngine()).togglePlay();haptic('selection');}
  else await play();
}

export function seek(beat: number) {
  if (engine) engine.seek(beat);
  else useTransport.getState().setPosition(Math.max(0, beat));
}

export function previewNote(trackId: string, midi: number, velocity = 0.8) {
  unlockAudio();
  void loadEngine().then((m) => m.previewNote(trackId, midi, velocity));
}

/** Gesto: hold a chord on a track until the next liveChord or liveRelease. */
export function liveChord(trackId: string, midis: number[], velocity = 0.8) {
  unlockAudio();
  void loadEngine().then((m) => m.liveChord(trackId, midis, velocity));
}

/** Gesto: one short note next to the held chord (arpeggiator steps). */
export function liveNote(trackId: string, midi: number, durSec: number, velocity = 0.8) {
  void loadEngine().then((m) => m.liveNote(trackId, midi, durSec, velocity));
}

export function liveRelease(trackId: string) {
  // Queued behind any chord still waiting for the engine, so it can't outlive the release.
  if (engine) engine.liveRelease(trackId);
  else if (loading) void loading.then((m) => m.liveRelease(trackId));
}

/** Gesto live band: load the monitor voices of these tracks (after they exist in the graph). */
export async function prepareLive(trackIds: string[]) {
  await (await loadEngine()).prepareLive(trackIds);
}

/** Gesto live band: one note/hit at a song beat, on the transport clock. False if it couldn't be placed. */
export function scheduleLive(trackId: string, beat: number, pitch: number, durBeats: number, velocity: number): boolean {
  return engine?.scheduleLive(trackId, beat, pitch, durBeats, velocity) ?? false;
}

export function scheduleLiveRelease(trackId: string, beat: number) {
  engine?.scheduleLiveRelease(trackId, beat);
}

export function clearLive() {
  engine?.clearLive();
}

export function lookAheadSeconds(): number {
  return engine?.lookAheadSeconds() ?? 0.12;
}

/** Exact song position in beats (the transport store's playhead updates at 60 fps). */
export function currentBeat(): number {
  return engine?.currentBeat() ?? useTransport.getState().position;
}

export async function previewSample(sampleId: string) {
  unlockAudio();
  await (await loadEngine()).previewSample(sampleId);
}

export function stopPreview() {
  engine?.stopPreview();
}

export function getMasterLevels(): number[] {
  return engine?.getMasterLevels() ?? [-Infinity, -Infinity];
}

export function getTrackLevel(trackId: string): number {
  return engine?.getTrackLevel(trackId) ?? -Infinity;
}

// Bounces render at the playback context's sample rate, so load the engine first.
export async function renderProject(project: Project, opts?: RenderOptions): Promise<PcmData> {
  await loadEngine();
  return (await import('./render')).renderProject(project, opts);
}

export async function exportAudio(project: Project, format: ExportFormat, onProgress?: (fraction: number, stage: 'render' | 'encode') => void): Promise<Blob> {
  await loadEngine();
  return (await import('./render')).exportAudio(project, format, onProgress);
}

export async function renderSamplePreview(project: Project, sampleId: string) {
  await loadEngine();
  return (await import('./samplePreview')).renderSamplePreview(project, sampleId);
}
