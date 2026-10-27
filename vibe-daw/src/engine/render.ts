import * as Tone from 'tone';
import type { Project, Track } from '../model/types';
import { beatsToSeconds, projectLength } from '../model/project';
import { EngineGraph, preloadProject } from './graph';
import type { InstrumentAssets } from './instruments';
import { contextLock } from './lock';
import { resample, type PcmData } from './wav';
import { TRIM_TRAILING_SILENCE, trimmedLength, type ExportFormat } from './exportFormats';
import { activeSpan, audibleTracks, effectTail, trackTail } from './renderPlan';
import { frozenFor, playbackSampleRate, type Frozen } from './freeze';
import { planMp3Chunks } from './mp3frames';
import { audioBudget, renderWorkers } from './budget';
import { encodeWavOffThread } from './wavEncode';
import { withRenderSlot } from './renderQueue';

// Offline bounce. Used for exports and - more importantly - for the agent's ears:
// it renders exactly what the user would hear and hands it to Gemini.
//
// Speed comes from three things:
//  1. Stems in parallel. Each track renders in its own OfflineAudioContext (Chrome
//     gives each one a thread), then stems are summed and the master bus runs once.
//  2. Each stem only renders the span where its track has clips (plus tail).
//  3. Windowed rendering inside each context: the native context suspends every
//     second and Tone's clock advances one window ahead, so only sounding voices
//     exist instead of every note's nodes for the whole song.

export interface RenderOptions {
  startBeat?: number;
  endBeat?: number;
  /** Solo these tracks (ids). */
  onlyTracks?: string[] | null;
  /** Extra seconds after the end for reverb/release tails. */
  tail?: number;
  /** Defaults to the playback context's rate, so the bounce matches what plays. */
  sampleRate?: number;
  /** 0..1 as rendering advances. */
  onProgress?: (fraction: number) => void;
  /** Render tracks as parallel stems (default) or the whole mix in one pass. */
  stems?: boolean;
  /** Skip the master bus (used to freeze single tracks). */
  master?: boolean;
  /** Freeze jobs disable reuse; exports and listening share the editor's audio. */
  reuseFrozen?: boolean;
}

const WINDOW_SEC = 1;
const AHEAD_SEC = 0.25;
// Compressors and limiters in the realtime graph have been idling on silence before
// playback starts. Offline they would start cold and clamp the first hits differently,
// so every pass renders this much silence first and drops it.
const PREROLL_SEC = 0.5;

interface OfflineInternals {
  _currentTime: number;
  emit(event: 'tick'): void;
}

interface PassSpec {
  project: Project;
  assets: Map<string, InstrumentAssets>;
  startBeat: number;
  endBeat: number;
  tail: number;
  sampleRate: number;
  onlyTracks: string[] | null;
  bypassMaster: boolean;
  /** Pre-mixed audio to play into the master bus (master pass). */
  input?: Float32Array[];
  onProgress?: (fraction: number) => void;
  frozenTracks?: ReadonlyMap<string, Frozen>;
}

/**
 * One offline render pass. The graph is built while holding the context lock (Tone's
 * global context is swapped during construction); the lock is released before the
 * audio thread starts, so several passes can render at once.
 */
function renderPass(spec: PassSpec): Promise<Float32Array[]> {
  return withRenderSlot(() => nativeRenderPass(spec));
}

async function nativeRenderPass(spec: PassSpec): Promise<Float32Array[]> {
  const { project: p, sampleRate } = spec;
  const prerollFrames = Math.round(PREROLL_SEC * sampleRate / 128) * 128;
  const preroll = prerollFrames / sampleRate;
  const frames = prerollFrames + Math.max(128, Math.ceil((beatsToSeconds(p, spec.endBeat - spec.startBeat) + spec.tail) * sampleRate));
  const duration = frames / sampleRate;
  const nativeCtx = new OfflineAudioContext(2, frames, sampleRate);
  let failure: unknown = null;
  let offline: Tone.OfflineContext | undefined;
  let inputSource: Tone.ToneBufferSource | undefined;

  const graph = await contextLock.run(async () => {
    const previous = Tone.getContext();
    // Hand Tone a native OfflineAudioContext. Tone's default wrapper builds offline
    // nodes only when rendering starts, so voices created in later windows would be
    // silent; native nodes join the graph immediately.
    const ctx = new Tone.OfflineContext(nativeCtx as never);
    offline = ctx;
    Tone.setContext(ctx);
    let g: EngineGraph | undefined;
    try {
      g = new EngineGraph({ live: false, onlyTracks: spec.onlyTracks, bypassMaster: spec.bypassMaster, frozenTracks: spec.frozenTracks });
      await g.sync(p, spec.assets);
      // Phase modulation for the song position now, while timing is exact; the
      // transport's start event (or, in the master pass, nothing) re-aligns in place.
      g.alignLfos(preroll, beatsToSeconds(p, spec.startBeat));
      if (spec.input) {
        const buf = new AudioBuffer({ length: spec.input[0].length, numberOfChannels: spec.input.length, sampleRate });
        spec.input.forEach((d, i) => buf.copyToChannel(d as Float32Array<ArrayBuffer>, i));
        const src = new Tone.ToneBufferSource({ url: buf, context: ctx });
        inputSource = src;
        src.connect(g.masterInput);
        src.start(preroll);
      } else {
        ctx.transport.start(preroll, beatsToSeconds(p, spec.startBeat));
        ctx.transport.stop(duration);
      }
      const clock = ctx as unknown as OfflineInternals;
      const block = 128 / sampleRate;
      // Step in exact integer blocks: accumulating floats drifts, and Tone then fires
      // events that land on a block boundary twice (doubled notes in the bounce).
      let step = Math.round(clock._currentTime / block);
      const advance = (to: number) => {
        const limit = Math.min(to, duration);
        while (clock._currentTime < limit) {
          clock.emit('tick');
          clock._currentTime = ++step * block;
        }
      };
      advance(WINDOW_SEC + AHEAD_SEC);
      for (let t = WINDOW_SEC; t < duration - block; t += WINDOW_SEC) {
        const at = Math.round((t * sampleRate) / 128) * 128 / sampleRate;
        nativeCtx.suspend(at).then(() => {
          // Always resume, even if a scheduled callback throws - otherwise the bounce hangs.
          try {
            if (!failure) advance(at + WINDOW_SEC + AHEAD_SEC);
          } catch (e) {
            failure = e;
          }
          try { spec.onProgress?.(Math.max(0, at - preroll) / (duration - preroll)); }
          catch (e) { failure ??= e; }
          finally { void nativeCtx.resume().catch((e) => { failure ??= e; }); }
        }, () => { /* suspend time already passed */ });
      }
      return g;
    } catch (e) {
      g?.dispose(); inputSource?.dispose(); ctx.dispose();
      throw e;
    } finally {
      Tone.setContext(previous);
    }
  });
  try {
    const rendered = await nativeCtx.startRendering();
    if (failure) throw failure;
    spec.onProgress?.(1);
    return [rendered.getChannelData(0).subarray(prerollFrames), rendered.getChannelData(1).subarray(prerollFrames)];
  } finally { graph.dispose(); inputSource?.dispose(); offline?.dispose(); }
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

export async function renderProject(project: Project, opts: RenderOptions = {}): Promise<PcmData> {
  const start = Math.max(0, opts.startBeat ?? 0);
  const end = Math.max(start + 0.25, opts.endBeat ?? projectLength(project));
  const audible = audibleTracks(project.tracks, opts.onlyTracks);
  const tail = opts.tail ?? Math.max(1.5, ...audible.map((t) => trackTail(t, project.bpm))) + (opts.master === false ? 0 : effectTail(project.master.effects, project.bpm));
  const sampleRate = opts.sampleRate ?? Math.min(96000, playbackSampleRate());
  if (![start, end, tail, sampleRate, project.bpm].every(Number.isFinite) || project.bpm <= 0 || tail < 0 || sampleRate < 8000 || sampleRate > 96000 || !Number.isInteger(sampleRate)) throw new RangeError('Invalid render timing or sample rate.');
  // Render a loop-free copy: bounces always run straight through.
  const p: Project = { ...project, loop: { ...project.loop, enabled: false }, tracks: project.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.start < end).map((c) => c.start + c.length > end ? { ...c, length: end - c.start } : c) })) };
  const frozenTracks = new Map<string, Frozen>();
  if (opts.reuseFrozen !== false) for (const t of audible) {
    const f = frozenFor(project, t);
    const span = activeSpan(t, 0, Infinity);
    if (f && (tail === 0 || !span || end >= span[1])) frozenTracks.set(t.id, f);
  }
  const total = Math.ceil((beatsToSeconds(p, end - start) + tail) * sampleRate);
  const outputBytes = total * 2 * Float32Array.BYTES_PER_ELEMENT;
  if (outputBytes > audioBudget().maxOutputBytes) throw new RangeError('This bounce exceeds this device’s audio memory budget. Export a shorter section or use a lower sample rate.');
  const workers = renderWorkers(outputBytes);
  const assets = await preloadProject({ ...p, tracks: audible.filter((t) => !frozenTracks.has(t.id)) });
  // Frozen tracks only stream their buffers, so parallel stems buy nothing for them
  // and each extra pass costs a full-length run of Tone's clock on the main thread.
  if (opts.stems === false || workers === 1 || audible.length <= 1 || audible.every((t) => frozenTracks.has(t.id))) {
    const one = await renderPass({ project: p, assets, startBeat: start, endBeat: end, tail, sampleRate, onlyTracks: opts.onlyTracks ?? null, bypassMaster: opts.master === false, onProgress: opts.onProgress, frozenTracks });
    return { sampleRate, channels: one };
  }
  const mix = [new Float32Array(total), new Float32Array(total)];

  // Stems, in parallel: one per live track, plus one shared by all frozen tracks.
  // Longest first so the pool finishes evenly.
  const spans = audible
    .map((t) => ({ tracks: [t], span: activeSpan(t, start, end) }))
    .filter((x): x is { tracks: Track[]; span: [number, number] } => !!x.span);
  const frozen = spans.filter((x) => frozenTracks.has(x.tracks[0].id));
  const stems = spans.filter((x) => !frozenTracks.has(x.tracks[0].id));
  if (frozen.length) stems.push({ tracks: frozen.flatMap((x) => x.tracks), span: [Math.min(...frozen.map((x) => x.span[0])), Math.max(...frozen.map((x) => x.span[1]))] });
  stems.sort((a, b) => (b.span[1] - b.span[0]) - (a.span[1] - a.span[0]));
  const weight = stems.reduce((s, x) => s + (x.span[1] - x.span[0]), 0) || 1;
  const done = new Map<string, number>();
  const report = () => opts.onProgress?.(0.92 * [...done.values()].reduce((a, b) => a + b, 0) / weight);
  await pool(stems, workers, async ({ tracks, span }) => {
    const len = span[1] - span[0];
    const key = tracks[0].id;
    const stem = await renderPass({
      project: p, assets, startBeat: span[0], endBeat: span[1], tail: Math.max(tail, ...tracks.map((t) => trackTail(t, p.bpm))), sampleRate,
      onlyTracks: tracks.map((t) => t.id), bypassMaster: true,
      frozenTracks,
      onProgress: (f) => { done.set(key, f * len); report(); },
    });
    const offset = Math.round(beatsToSeconds(p, span[0] - start) * sampleRate);
    for (let c = 0; c < 2; c++) {
      const dst = mix[c], src = stem[c];
      const n = Math.min(src.length, total - offset);
      for (let i = 0; i < n; i++) dst[offset + i] += src[i];
    }
  });

  if (opts.master === false) { opts.onProgress?.(1); return { sampleRate, channels: mix }; }
  // Master bus once, over the summed stems.
  const out = await renderPass({
    project: { ...p, tracks: [] }, assets, startBeat: start, endBeat: end, tail, sampleRate,
    onlyTracks: [], bypassMaster: false, input: mix,
    onProgress: (f) => opts.onProgress?.(0.92 + 0.08 * f),
  });
  return { sampleRate, channels: out };
}

/**
 * Encode PCM to MP3 off the main thread. Long exports are split across several
 * workers (one core each) and joined frame by frame; see mp3frames.ts.
 */
function encodeMp3(pcm: PcmData, kbps: number, onProgress?: (f: number) => void): Promise<Blob> {
  const [left, right = left] = pcm.channels;
  const parts = renderWorkers(left.byteLength + right.byteLength);
  const chunks = planMp3Chunks(left.length, pcm.sampleRate, kbps, parts);
  const done = chunks.map(() => 0);
  const workers: Worker[] = [];
  const stopAll = () => workers.forEach((w) => w.terminate());
  return Promise.all(chunks.map((chunk, i) => new Promise<Uint8Array>((resolve, reject) => {
    const worker = new Worker(new URL('./mp3.worker.ts', import.meta.url), { type: 'module' });
    workers.push(worker);
    worker.onmessage = (e: MessageEvent<{ progress?: number; data?: Uint8Array; error?: string }>) => {
      if (e.data.progress !== undefined) {
        done[i] = e.data.progress * (chunk.to - chunk.from);
        onProgress?.(done.reduce((a, b) => a + b, 0) / chunks.reduce((n, c) => n + c.to - c.from, 0));
      }
      if (e.data.error) reject(new Error(e.data.error));
      if (e.data.data) { worker.terminate(); resolve(e.data.data); }
    };
    worker.onerror = (e) => reject(new Error(e.message || 'MP3 encoder failed'));
    // A single chunk takes the whole buffers (no copy); split encodes get slices.
    const whole = chunks.length === 1;
    const l = whole ? left : left.slice(chunk.from, chunk.to);
    const r = whole ? right : right.slice(chunk.from, chunk.to);
    worker.postMessage({ left: l, right: r, sampleRate: pcm.sampleRate, kbps, skip: chunk.skip, keep: chunk.keep }, [...new Set([l.buffer, r.buffer])]);
  }))).then(
    (data) => new Blob(data as BlobPart[], { type: 'audio/mpeg' }),
    (e) => { stopAll(); throw e; },
  );
}

/** Bounce and encode. Progress covers rendering (first 80%) then encoding. */
export async function exportAudio(project: Project, format: ExportFormat, onProgress?: (fraction: number, stage: 'render' | 'encode') => void): Promise<Blob> {
  const renderShare = format === 'mp3' ? 0.8 : 0.95;
  let pcm = await renderProject(project, { onProgress: (f) => onProgress?.(f * renderShare, 'render') });
  if (TRIM_TRAILING_SILENCE) {
    const keep = trimmedLength(pcm.channels, pcm.sampleRate);
    pcm = { ...pcm, channels: pcm.channels.map((c) => keep < c.length ? c.slice(0, keep) : c) };
  }
  if (format === 'mp3') {
    // MP3 tops out at 48 kHz; high-rate devices get a band-limited downsample.
    if (pcm.sampleRate > 48000) {
      const { sampleRate: from, channels } = pcm;
      const to = from % 44100 === 0 ? 44100 : 48000;
      pcm = { sampleRate: to, channels: channels.map((c) => resample(c, from, to)) };
    }
    return encodeMp3(pcm, 320, (f) => onProgress?.(renderShare + f * (1 - renderShare), 'encode'));
  }
  onProgress?.(renderShare, 'encode');
  const blob = await encodeWavOffThread(pcm, format === 'wav24' ? 24 : 16);
  onProgress?.(1, 'encode');
  return blob;
}
