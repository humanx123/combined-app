import type { Clip, Project, Track } from '../model/types';
import { createAudioClip, createTrack, secondsToBeats } from '../model/project';
import { getAudioRevision, getLoadedBuffer, loadBuffer } from '../samples/library';
import { renderProject } from './render';
import type { PcmData } from './wav';

export interface SamplePreview { pcm: PcmData; context: string; signature: string }
const cache = new WeakMap<Project, Map<string, number>>();
const results = new Map<number, SamplePreview>();
const MAX_BYTES = 64 * 1024 * 1024;
let nextToken = 0;
let cachedBytes = 0;
const sizeOf = (r: SamplePreview) => r.pcm.channels.reduce((n, c) => n + c.byteLength, 0);

/** Shared by library playback and AI auditions: actual clip/lane pitch, level and FX. */
export async function renderSamplePreview(project: Project, sampleId: string, maxSeconds = 30): Promise<SamplePreview> {
  const key = `${sampleId}|${maxSeconds}|${getAudioRevision()}`;
  const token = cache.get(project)?.get(key);
  const have = token === undefined ? undefined : results.get(token);
  if (have) { results.delete(token!); results.set(token!, have); return have; }
  const buffer = getLoadedBuffer(sampleId) ?? await loadBuffer(sampleId);
  if (!buffer) throw new Error(`Could not load sample ${sampleId}`);
  let selected: Track | undefined;
  for (const t of project.tracks) {
    const lanes = new Set(t.drumLanes?.filter((l) => l.sampleId === sampleId).map((l) => l.note) ?? []);
    const clips = t.clips.flatMap<Clip>((c) => {
      if (c.muted) return [];
      if (c.type === 'audio') return c.sampleId === sampleId ? [c] : [];
      const notes = c.notes.filter((n) => lanes.has(n.pitch) && n.start < c.length);
      return notes.length ? [{ ...c, notes }] : [];
    });
    if (clips.length) { selected = { ...t, clips }; break; }
  }
  const inProject = !!selected;
  const preview: Project = { ...project, tracks: [...project.tracks], loop: { ...project.loop, enabled: false } };
  if (!selected) {
    selected = createTrack(preview, 'audio', { name: 'Sample preview' });
    selected.volumeDb = 0;
    selected.clips.push({ ...createAudioClip(preview, sampleId, 0, secondsToBeats(project, Math.min(maxSeconds, buffer.duration))), gainDb: -4 });
    preview.tracks.push(selected);
  } else preview.tracks = preview.tracks.map((t) => t.id === selected!.id ? selected! : t);
  let start = Infinity, end = -Infinity;
  for (const c of selected.clips) {
    const onset = c.type === 'midi' ? Math.min(...c.notes.map((n) => n.start)) : 0;
    start = Math.min(start, c.start + onset);
    end = Math.max(end, c.start + c.length);
  }
  const maxBeats = secondsToBeats(project, maxSeconds);
  const stop = Math.min(end, start + maxBeats);
  const pcm = await renderProject(preview, { startBeat: start, endBeat: stop, onlyTracks: [selected.id], tail: Math.min(0.5, Math.max(0, maxSeconds - (stop - start) * 60 / project.bpm)) });
  const context = inProject ? `As played on ${selected.name}: original pitch, velocity, gain, panning, clip settings, track FX and master bus.` : 'Library preview at native pitch, -4 dB, through the project master bus.';
  // Persist only a small fingerprint with the description, never an audio payload.
  const duckSources = new Set(selected.effects.filter((e) => e.type === 'duck' && e.enabled).map((e) => String(e.params.source)));
  const bytes = new TextEncoder().encode(JSON.stringify([selected, project.master, project.bpm, project.swing, project.timeSignature, project.tracks.filter((t) => duckSources.has(t.id))]));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const signature = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
  const result = { pcm, context, signature };
  const size = sizeOf(result);
  while (results.size && (cachedBytes + size > MAX_BYTES || results.size >= 24)) {
    const oldest = results.keys().next().value!;
    cachedBytes -= sizeOf(results.get(oldest)!); results.delete(oldest);
  }
  if (size <= MAX_BYTES) {
    const token = ++nextToken;
    results.set(token, result); cachedBytes += size;
    const entries = cache.get(project) ?? new Map<string, number>();
    if (entries.size >= 24) entries.delete(entries.keys().next().value!);
    entries.set(key, token); cache.set(project, entries);
  }
  return result;
}
