import { create } from 'zustand';
import { del, get as idbGet, set as idbSet } from 'idb-keyval';
import type { SampleMeta } from '../model/types';
import { audioBufferToPcm, encodeWav } from '../engine/wav';
import { estimateKey, estimatePitch, estimateTempo } from './analysis';
import * as S from './synth';

// Sample library: built-in synthesized kit + user uploads + AI-generated loops.
// Metadata is reactive (zustand); decoded AudioBuffers live in a plain Map.

interface LibraryState {
  samples: Record<string, SampleMeta>;
  ready: boolean;
  upsert: (meta: SampleMeta) => void;
  remove: (id: string) => void;
}

export const useLibrary = create<LibraryState>((set) => ({
  samples: {},
  ready: false,
  upsert: (meta) => set((s) => ({ samples: { ...s.samples, [meta.id]: meta } })),
  remove: (id) => set((s) => {
    const next = { ...s.samples };
    delete next[id];
    return { samples: next };
  }),
}));

const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
let audioRevision = 0;
export const getAudioRevision = () => audioRevision;
const INDEX_KEY = 'vibe:samples:index';
const blobKey = (id: string) => `vibe:sample:${id}`;

/** Optional hook the cloud layer installs to fetch samples this device has never seen. */
let remoteFetcher: ((meta: SampleMeta | undefined, id: string) => Promise<ArrayBuffer | null>) | null = null;
export function setRemoteSampleFetcher(fn: typeof remoteFetcher) {
  remoteFetcher = fn;
}
/** Optional hook to push new samples to the cloud. */
let remoteUploader: ((meta: SampleMeta, data: ArrayBuffer, mime: string) => Promise<string | null>) | null = null;
export function setRemoteSampleUploader(fn: typeof remoteUploader) {
  remoteUploader = fn;
}

let decodeCtx: OfflineAudioContext | null = null;
export async function decodeAudio(data: ArrayBuffer): Promise<AudioBuffer> {
  decodeCtx ??= new OfflineAudioContext(2, 1, 44100);
  return decodeCtx.decodeAudioData(data.slice(0));
}

// ------------------------------------------------------------------ built-ins

type Builtin = [id: string, name: string, category: string, tags: string[], make: () => Promise<AudioBuffer>, rootNote?: number];

const BUILTINS: Builtin[] = [
  ['b-kick-punchy', 'Punchy Kick', 'kick', ['trap', 'tight', 'modern'], () => S.kick()],
  ['b-kick-hard', 'Hard Kick', 'kick', ['drill', 'aggressive', 'clicky'], () => S.kick({ pitchStart: 220, pitchEnd: 52, click: 0.9, drive: 0.5, decay: 0.32 })],
  ['b-kick-dusty', 'Dusty Kick', 'kick', ['boom bap', 'lofi', 'soft', 'warm'], () => S.kick({ pitchStart: 120, pitchEnd: 50, click: 0.15, drive: 0.35, decay: 0.38 })],
  ['b-kick-house', 'House Kick', 'kick', ['house', 'four on the floor', 'round'], () => S.kick({ pitchStart: 180, pitchEnd: 46, pitchDecay: 0.04, decay: 0.5, click: 0.4 })],
  ['b-kick-boom', 'Boom Kick', 'kick', ['long', 'subby', 'cloud'], () => S.kick({ pitchStart: 130, pitchEnd: 40, pitchDecay: 0.09, decay: 0.9, click: 0.2, drive: 0.1 })],
  ['b-808-clean', 'Clean 808', '808', ['808', 'clean', 'round', 'sub'], () => S.bass808({ drive: 0.1, decay: 1.8 }), 36],
  ['b-808-dirty', 'Distorted 808', '808', ['808', 'distorted', 'gritty', 'emo', 'rage'], () => S.bass808({ drive: 0.75, decay: 1.9, punch: 0.7 }), 36],
  ['b-808-long', 'Long 808', '808', ['808', 'long', 'sliding', 'drill'], () => S.bass808({ decay: 3.2, drive: 0.3 }), 36],
  ['b-808-punchy', 'Punchy 808', '808', ['808', 'short', 'punchy', 'bouncy'], () => S.bass808({ decay: 0.9, punch: 1, click: 0.6, drive: 0.4 }), 36],
  ['b-snare-trap', 'Trap Snare', 'snare', ['trap', 'crisp'], () => S.snare()],
  ['b-snare-crack', 'Crack Snare', 'snare', ['drill', 'bright', 'short', 'snappy'], () => S.snare({ tone: 230, noiseDecay: 0.12, brightness: 0.95, snap: 1, drive: 0.3 })],
  ['b-snare-dusty', 'Dusty Snare', 'snare', ['boom bap', 'lofi', 'dark'], () => S.snare({ tone: 170, noiseDecay: 0.22, brightness: 0.2, snap: 0.3, drive: 0.4 })],
  ['b-snare-fat', 'Fat Snare', 'snare', ['emo', 'big', 'roomy', 'pop punk'], () => S.snare({ tone: 160, bodyDecay: 0.16, noiseDecay: 0.32, brightness: 0.5, snap: 0.5 })],
  ['b-clap-wide', 'Wide Clap', 'clap', ['trap', 'clap', 'layer'], () => S.clap()],
  ['b-clap-tight', 'Tight Clap', 'clap', ['short', 'snappy'], () => S.clap({ decay: 0.12, spread: 0.008, brightness: 0.8 })],
  ['b-clap-big', 'Big Clap', 'clap', ['reverb', 'big', 'house'], () => S.clap({ decay: 0.45, spread: 0.014, brightness: 0.4 })],
  ['b-hat-tight', 'Tight Hat', 'hat', ['trap', 'closed', 'rolls'], () => S.hat()],
  ['b-hat-crisp', 'Crisp Hat', 'hat', ['bright', 'closed'], () => S.hat({ decay: 0.03, brightness: 1, metal: 0.8 })],
  ['b-hat-dusty', 'Dusty Hat', 'hat', ['boom bap', 'lofi', 'dark', 'closed'], () => S.hat({ decay: 0.06, brightness: 0.2, metal: 0.3 })],
  ['b-openhat', 'Open Hat', 'openhat', ['open', 'trap'], () => S.hat({ decay: 0.32, brightness: 0.7 })],
  ['b-openhat-long', 'Long Open Hat', 'openhat', ['open', 'long', 'washy'], () => S.hat({ decay: 0.7, brightness: 0.5 })],
  ['b-crash', 'Crash', 'crash', ['cymbal', 'transition'], () => S.cymbal()],
  ['b-ride', 'Ride', 'crash', ['cymbal', 'ride', 'house'], () => S.cymbal({ decay: 2.4, brightness: 0.9 })],
  ['b-perc-rim', 'Rimshot', 'perc', ['rim', 'click', 'trap'], () => S.tonalPerc({ freq: 1700, decay: 0.035, noise: 0.6, bend: 1.2 })],
  ['b-perc-conga', 'Conga', 'perc', ['conga', 'afro', 'house'], () => S.tonalPerc({ freq: 330, decay: 0.18, noise: 0.1 })],
  ['b-perc-tom', 'Low Tom', 'perc', ['tom', 'fill'], () => S.tonalPerc({ freq: 140, decay: 0.32, noise: 0.15, bend: 2 })],
  ['b-perc-wood', 'Woodblock', 'perc', ['wood', 'plugg', 'click'], () => S.tonalPerc({ freq: 900, decay: 0.05, noise: 0.2, bend: 1.1 })],
  ['b-shaker', 'Shaker', 'perc', ['shaker', 'groove'], () => S.shaker()],
  ['b-fx-riser', 'Noise Riser', 'fx', ['riser', 'build', 'transition'], () => S.riser()],
  ['b-fx-downlifter', 'Downlifter', 'fx', ['downlifter', 'transition', 'drop'], () => S.downlifter()],
  ['b-fx-impact', 'Sub Impact', 'fx', ['impact', 'boom', 'drop'], () => S.impact()],
  ['b-tex-vinyl', 'Vinyl Crackle', 'texture', ['vinyl', 'lofi', 'dust', 'loop', 'emo'], () => S.vinylCrackle()],
];

let initPromise: Promise<void> | null = null;
export function initLibrary(): Promise<void> {
  if (!initPromise) {
    initPromise = initializeLibrary();
    void initPromise.catch(() => { initPromise = null; });
  }
  return initPromise;
}

async function initializeLibrary(): Promise<void> {
  const lib = useLibrary.getState();
  const now = Date.now();
  await Promise.all(
    BUILTINS.map(async ([id, name, category, tags, make, rootNote]) => {
      const buf = await make();
      buffers.set(id, buf);
      lib.upsert({
        id, name, category, tags, source: 'builtin', duration: buf.duration, createdAt: now,
        kind: category === 'texture' ? 'loop' : 'oneshot', rootNote,
      });
    }),
  );
  try {
    const index = (await idbGet<SampleMeta[]>(INDEX_KEY)) ?? [];
    for (const meta of index) useLibrary.getState().upsert(meta);
  } catch (e) {
    console.warn('Sample index unavailable', e);
  }
  useLibrary.setState({ ready: true });
  ++audioRevision;
}

async function persistIndex() {
  const metas = Object.values(useLibrary.getState().samples).filter((m) => m.source !== 'builtin');
  try {
    await idbSet(INDEX_KEY, metas);
  } catch (e) {
    console.warn('Could not persist sample index', e);
  }
}

/** Cloud metadata can arrive after the project; persist it and notify audio/UI. */
export function mergeRemoteSamples(samples: SampleMeta[]) {
  if (!samples.length) return;
  // A cloud snapshot can contain hundreds of sounds. Publish it once so the
  // browser and audio graph don't repeat their work for each individual entry.
  useLibrary.setState((s) => {
    const merged = { ...s.samples };
    for (const meta of samples) merged[meta.id] = { ...merged[meta.id], ...meta };
    return { samples: merged };
  });
  void persistIndex();
}

/** Upload referenced local audio before the project is reported as synced. */
export async function syncSamples(ids: Iterable<string>, localOnly = false, ownerUid?: string): Promise<void> {
  if (!remoteUploader) return;
  for (const id of new Set(ids)) {
    const meta = getSampleMeta(id);
    const owned = meta?.storagePath && (!ownerUid || meta.storagePath.startsWith(`users/${ownerUid}/samples/`));
    if (meta?.source === 'builtin' || owned || id.startsWith('b-')) continue;
    if (!meta) {
      if (localOnly) continue;
      throw new Error(`Audio file ${id} is missing on this device. Sync the song from the original computer.`);
    }
    const stored = await idbGet<{ data: ArrayBuffer; mime: string }>(blobKey(id));
    const buffer = buffers.get(id);
    const audio = stored ?? (buffer ? { data: encodeWav(audioBufferToPcm(buffer)), mime: 'audio/wav' } : null);
    if (!audio) {
      if (localOnly) continue;
      throw new Error(`Audio file “${meta.name}” is missing on this device. Sync the song from the original computer.`);
    }
    const path = await remoteUploader(meta, audio.data, audio.mime);
    if (!path) throw new Error('Sign in to sync audio files.');
    updateSampleMeta(id, { storagePath: path });
  }
}

// ------------------------------------------------------------------ access

export function getSampleMeta(id: string): SampleMeta | undefined {
  return useLibrary.getState().samples[id];
}

export function getLoadedBuffer(id: string): AudioBuffer | undefined {
  return buffers.get(id);
}

export async function loadBuffer(id: string): Promise<AudioBuffer | null> {
  const have = buffers.get(id);
  if (have) return have;
  const pending = loading.get(id);
  if (pending) return pending;
  const p = (async () => {
    try {
      let stored = await idbGet<{ data: ArrayBuffer; mime: string }>(blobKey(id));
      if (!stored && remoteFetcher) {
        const meta = getSampleMeta(id);
        // The sample index may still be downloading when a cloud project opens.
        const data = await remoteFetcher(meta, id);
        if (data) {
          stored = { data, mime: 'audio/wav' };
          await idbSet(blobKey(id), stored);
        }
      }
      if (!stored) return null;
      const buf = await decodeAudio(stored.data);
      buffers.set(id, buf);
      ++audioRevision;
      return buf;
    } catch (e) {
      console.warn(`Could not load sample ${id}`, e);
      return null;
    } finally {
      loading.delete(id);
    }
  })();
  loading.set(id, p);
  return p;
}

export interface AddSampleInput {
  name: string;
  category: string;
  kind?: 'oneshot' | 'loop';
  tags?: string[];
  source: SampleMeta['source'];
  attribution?: SampleMeta['attribution'];
  prompt?: string;
  bpm?: number;
  key?: string;
  /** Skip tempo/key/pitch detection */
  skipAnalysis?: boolean;
}

/** Register a new sample from an AudioBuffer (designed, rendered, sliced) or encoded bytes (uploads). */
export async function addSample(input: AddSampleInput, audio: AudioBuffer | { data: ArrayBuffer; mime: string }, decoded?: AudioBuffer): Promise<SampleMeta> {
  let buffer: AudioBuffer;
  let stored: { data: ArrayBuffer; mime: string };
  if (audio instanceof AudioBuffer) {
    buffer = audio;
    stored = { data: encodeWav(audioBufferToPcm(audio), 16), mime: 'audio/wav' };
  } else {
    buffer = decoded ?? await decodeAudio(audio.data);
    stored = audio;
  }
  const id = `s-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
  const meta: SampleMeta = {
    id,
    name: input.name,
    category: input.category,
    kind: input.kind ?? (buffer.duration > 2.5 ? 'loop' : 'oneshot'),
    tags: input.tags ?? [],
    source: input.source,
    duration: buffer.duration,
    bpm: input.bpm,
    key: input.key,
    prompt: input.prompt,
    attribution: input.attribution,
    createdAt: Date.now(),
  };
  if (!input.skipAnalysis) Object.assign(meta, analyzeForMeta(buffer, meta));
  buffers.set(id, buffer);
  ++audioRevision;
  useLibrary.getState().upsert(meta);
  try {
    await idbSet(blobKey(id), stored);
  } catch (e) {
    console.warn('Could not store sample', e);
  }
  await persistIndex();
  if (remoteUploader) {
    remoteUploader(meta, stored.data, stored.mime)
      .then((path) => { if (path) updateSampleMeta(id, { storagePath: path }); })
      .catch((e) => console.warn('Sample upload failed', e));
  }
  return meta;
}

function analyzeForMeta(buffer: AudioBuffer, meta: SampleMeta): Partial<SampleMeta> {
  const pcm = audioBufferToPcm(buffer, 90);
  const out: Partial<SampleMeta> = {};
  try {
    if (meta.kind === 'loop' && !meta.bpm) {
      const t = estimateTempo(pcm);
      if (t && t.confidence > 0.05) out.bpm = t.bpm;
    }
    if (!meta.key && meta.kind === 'loop' && buffer.duration > 1) {
      const k = estimateKey(pcm);
      if (k && k.confidence > 0.5) out.key = k.key;
    }
    if (meta.kind === 'oneshot' && ['808', 'bass', 'keys', 'synth', 'guitar', 'vocal'].includes(meta.category)) {
      const p = estimatePitch(pcm);
      if (p) out.rootNote = p.midi;
    }
  } catch (e) {
    console.warn('Analysis failed', e);
  }
  return out;
}

export function updateSampleMeta(id: string, patch: Partial<SampleMeta>) {
  const meta = getSampleMeta(id);
  if (!meta) return;
  if (patch.bpm !== undefined && patch.bpm !== meta.bpm) ++audioRevision;
  useLibrary.getState().upsert({ ...meta, ...patch });
  if (meta.source !== 'builtin') void persistIndex();
}

export async function deleteSample(id: string) {
  useLibrary.getState().remove(id);
  buffers.delete(id);
  ++audioRevision;
  try {
    await del(blobKey(id));
  } catch { /* ignore */ }
  await persistIndex();
}

/** Simple ranked search over names, categories, tags, and AI descriptions. */
export function searchSamples(query = '', category?: string, limit = 40): SampleMeta[] {
  const all = Object.values(useLibrary.getState().samples);
  const words = query.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const scored = all
    .filter((m) => !category || m.category === category || (category === 'drums' && ['kick', 'snare', 'clap', 'hat', 'openhat', 'perc', 'crash'].includes(m.category)))
    .map((m) => {
      const hay = `${m.name} ${m.category} ${m.tags.join(' ')} ${m.aiDescription ?? ''} ${m.prompt ?? ''}`.toLowerCase();
      let score = words.length ? 0 : 1;
      for (const w of words) {
        if (m.category === w) score += 4;
        if (m.tags.includes(w)) score += 3;
        if (m.name.toLowerCase().includes(w)) score += 2;
        if (hay.includes(w)) score += 1;
      }
      if (m.source !== 'builtin') score += 0.5;
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.m.createdAt - a.m.createdAt);
  return scored.slice(0, limit).map((x) => x.m);
}

export async function getSampleBytes(id: string): Promise<{ data: ArrayBuffer; mime: string } | null> {
  const stored = await idbGet<{ data: ArrayBuffer; mime: string }>(blobKey(id));
  if (stored) return stored;
  const buf = buffers.get(id) ?? (await loadBuffer(id));
  if (!buf) return null;
  return { data: encodeWav(audioBufferToPcm(buf)), mime: 'audio/wav' };
}
