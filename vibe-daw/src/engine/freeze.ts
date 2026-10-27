import type { Project, Track } from '../model/types';
import { renderProject } from './render';
import { activeSpan, trackTail } from './renderPlan';
import { beatsToSeconds } from '../model/project';
import { audioBudget } from './budget';

// Background track freezing. Each instrument/drum track is rendered offline (its
// instrument and effects, pre-fader) and live playback streams that audio instead of
// running synths and effects in real time. Editing a track unfreezes it instantly
// (it plays live) and it re-freezes shortly after edits stop. Fader, pan, mute and
// solo stay live. Result: light CPU during playback, and playback == export.

export interface Frozen { sig: string; buffer: AudioBuffer; startBeat: number }

const cache = new Map<string, Frozen>();
const failed = new Map<string, string>();
const signatures = new WeakMap<Project, WeakMap<Track, string>>();
const MAX_RENDER_BYTES = 64 * 1024 * 1024;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let latest: Project | null = null;
let onChange: (() => void) | null = null;
let sampleRate = 48000;
let generation = 0;
let queued = new Map<string, string>();

/**
 * The realtime context's sample rate. Offline renders default to it: a bounce at any
 * other rate resamples samples and frozen tracks differently from playback, which
 * audibly changes the top end of drums and synths.
 */
export function playbackSampleRate(): number {
  return sampleRate;
}

export function configureFreeze(rate: number, changed: () => void) {
  if (sampleRate !== rate) { cache.clear(); failed.clear(); queued.clear(); generation++; }
  sampleRate = rate;
  onChange = changed;
}

/** Everything that affects a track's pre-fader sound. Mixer settings are excluded on purpose. */
export function freezeSignature(p: Project, t: Track): string {
  let map = signatures.get(p);
  if (!map) { map = new WeakMap(); signatures.set(p, map); }
  const cached = map.get(t);
  if (cached) return cached;
  const duckSources = t.effects.filter((e) => e.type === 'duck' && e.enabled).map((e) => String(e.params.source));
  const sources = p.tracks.filter((x) => duckSources.includes(x.id)).map((x) => [x.id, x.clips, x.drumLanes]);
  const { volumeDb: _v, pan: _p, mute: _m, solo: _s, name: _n, color: _c, ...sound } = t;
  void _v; void _p; void _m; void _s; void _n; void _c;
  const sig = JSON.stringify([sound.clips.map((c) => ({ ...c, aiPending: undefined, name: undefined })), sound.instrument, sound.drumLanes, sound.effects, sound.kind, p.bpm, p.swing, p.timeSignature, sources]);
  map.set(t, sig);
  return sig;
}

export function frozenFor(p: Project, t: Track): Frozen | null {
  const f = cache.get(t.id);
  return f && f.sig === freezeSignature(p, t) ? f : null;
}

function freezable(t: Track) {
  return t.kind !== 'audio' && t.clips.some((c) => !c.muted);
}

/** Queue background freezes for any track whose sound changed. */
export function scheduleFreeze(p: Project) {
  const switched = latest?.id !== p.id;
  if (switched) { cache.clear(); failed.clear(); generation++; }
  latest = p;
  const ids = new Set(p.tracks.map((t) => t.id));
  for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
  for (const id of failed.keys()) if (!ids.has(id)) failed.delete(id);
  const next = new Map(p.tracks.filter(freezable).map((t) => [t.id, freezeSignature(p, t)]));
  // Invalid audio cannot be reused; release it before reserving replacement PCM.
  for (const [id, frozen] of cache) if (next.get(id) !== frozen.sig) cache.delete(id);
  const changed = switched || next.size !== queued.size || [...next].some(([id, sig]) => queued.get(id) !== sig);
  queued = next;
  // Mixer/UI edits and freeze-completion syncs must not keep postponing the queue.
  if (changed) {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = undefined; void work(); }, 1200);
  }
}

async function work() {
  if (running) return;
  running = true;
  const inFlight = new Set<string>();
  let reservedBytes = 0;
  try {
    // Native offline contexts render on separate audio threads. Keep construction
    // serialized by renderProject's context lock, but let their DSP overlap. Leave
    // a core for playback/UI and bound simultaneous graphs and PCM allocations.
    // Safari's page process has a tighter memory budget, particularly on iOS.
    // All iOS browsers use WebKit, including ones with a Chrome/Firefox UA token.
    const { freezeCacheBytes: cacheLimit, workers } = audioBudget();
    await Promise.all(Array.from({ length: workers }, async () => {
      while (latest) {
        const p = latest;
        // Longest first avoids leaving a single expensive track until the end.
        const job = p.tracks
          .filter((t) => freezable(t) && !inFlight.has(t.id))
          .map((t) => ({ t, sig: freezeSignature(p, t), span: activeSpan(t, 0, Infinity) }))
          .filter((x): x is { t: Track; sig: string; span: [number, number] } => !!x.span && cache.get(x.t.id)?.sig !== x.sig && failed.get(x.t.id) !== x.sig)
          .sort((a, b) => (b.span[1] - b.span[0]) - (a.span[1] - a.span[0]))[0];
        if (!job) break;
        const { t: todo, sig, span } = job;
        const rate = sampleRate, version = generation;
        // Check BEFORE constructing an OfflineAudioContext: checking the cache
        // after rendering cannot prevent a native allocation from killing Safari.
        // Include tails/preroll and both the render output and its cache copy.
        const seconds = beatsToSeconds(p, span[1] - span[0]) + Math.max(1.5, trackTail(todo, p.bpm)) + 0.5;
        const renderBytes = Math.ceil(seconds * rate) * 2 * Float32Array.BYTES_PER_ELEMENT;
        const used = [...cache.values()].reduce((sum, f) => sum + f.buffer.length * f.buffer.numberOfChannels * 4, 0);
        if (!Number.isFinite(renderBytes) || renderBytes * 2 > MAX_RENDER_BYTES || used + renderBytes > cacheLimit) {
          failed.set(todo.id, sig);
          continue; // Large tracks keep playing through the live graph.
        }
        // Another worker will pick this job up when its current render finishes.
        if (reservedBytes + renderBytes * 2 > MAX_RENDER_BYTES || used + reservedBytes + renderBytes > cacheLimit) break;
        reservedBytes += renderBytes * 2;
        inFlight.add(todo.id);
        // Pre-fader: neutral volume/pan; the live channel applies the real mixer settings.
        const solo: Project = { ...p, tracks: p.tracks.map((t) => (t.id === todo.id ? { ...t, volumeDb: 0, pan: 0, mute: false, solo: false } : { ...t, solo: false })) };
        const startBeat = span[0];
        try {
          const pcm = await renderProject(solo, { startBeat, endBeat: span[1], onlyTracks: [todo.id], sampleRate: rate, master: false, reuseFrozen: false });
          const current = latest?.tracks.find((t) => t.id === todo.id);
          if (version !== generation || !latest || !current || freezeSignature(latest, current) !== sig) continue;
          const bytes = pcm.channels.reduce((sum, c) => sum + c.byteLength, 0);
          const used = [...cache.values()].reduce((sum, f) => sum + f.buffer.length * f.buffer.numberOfChannels * 4, 0) - (cache.get(todo.id)?.buffer.length ?? 0) * 8;
          // Leave large projects live instead of repeatedly evicting and re-freezing tracks.
          if (used + bytes > cacheLimit) { failed.set(todo.id, sig); continue; }
          const buffer = new AudioBuffer({ length: pcm.channels[0].length, numberOfChannels: 2, sampleRate: rate });
          pcm.channels.forEach((d, i) => buffer.copyToChannel(d as Float32Array<ArrayBuffer>, i));
          cache.set(todo.id, { sig, buffer, startBeat });
          onChange?.();
        } catch (e) {
          console.warn('Freeze failed; track keeps playing live', e);
          if (version === generation) failed.set(todo.id, sig);
        } finally { inFlight.delete(todo.id); reservedBytes -= renderBytes * 2; }
      }
    }));
  } finally {
    running = false;
  }
}
