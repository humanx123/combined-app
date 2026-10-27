import { useDaw, useTransport } from '../state/store';
import { beatsPerBar, cloneDeep, createAudioClip, createMidiClip, createTrack, secondsToBeats } from '../model/project';
import type { TrackKind } from '../model/types';
import { sliceClip } from '../model/edit';
import { getSampleMeta } from '../samples/library';
import { copyClips, getCopiedClips } from './clipboard';

// Editing commands shared by toolbar buttons and keyboard shortcuts.

export function deleteSelectedClips() {
  const daw = useDaw.getState();
  const ids = new Set(daw.selection.clipIds);
  if (!ids.size) return;
  daw.update('Delete clips', (d) => { for (const t of d.tracks) t.clips = t.clips.filter((c) => !ids.has(c.id)); });
  daw.select({ clipIds: [] });
  if (daw.editorClipId && ids.has(daw.editorClipId)) daw.openEditor(null);
}

/** Copy the selected clips to right after themselves. */
export function duplicateSelectedClips() {
  const daw = useDaw.getState();
  const ids = new Set(daw.selection.clipIds);
  if (!ids.size) return;
  const fresh: string[] = [];
  const selected = daw.project.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)));
  if (!selected.length) return;
  const shift = Math.max(...selected.map((c) => c.start + c.length)) - Math.min(...selected.map((c) => c.start));
  daw.update('Duplicate clips', (d) => {
    for (const t of d.tracks) {
      const sel = t.clips.filter((c) => ids.has(c.id));
      if (!sel.length) continue;
      for (const c of sel) {
        d.nextId++;
        const copy = { ...cloneDeep(c), id: `c${d.nextId}`, start: c.start + shift };
        delete copy.aiPending;
        t.clips.push(copy);
        fresh.push(copy.id);
      }
    }
  });
  daw.select({ clipIds: fresh });
}

/** New empty pattern on the selected track, at the bar under the playhead; opens the editor. */
export function newClipOnSelectedTrack(): string | null {
  const daw = useDaw.getState();
  const p = daw.project;
  const track = p.tracks.find((t) => t.id === daw.selection.trackId) ?? p.tracks.find((t) => t.kind !== 'audio');
  if (!track || track.kind === 'audio') return null;
  const bpb = beatsPerBar(p);
  const start = Math.floor(useTransport.getState().position / bpb) * bpb;
  let id = '';
  daw.update('New clip', (d) => {
    const t = d.tracks.find((x) => x.id === track.id)!;
    const c = createMidiClip(d, start, bpb * (track.kind === 'drums' ? 1 : 2), track.kind === 'drums' ? 'Beat' : 'Pattern');
    t.clips.push(c);
    id = c.id;
  });
  daw.select({ clipIds: [id], trackId: track.id });
  daw.openEditor(id);
  return id;
}

export function addTrack(kind: TrackKind) {
  let id = '';
  useDaw.getState().update('Add track', (d) => {
    const t = createTrack(d, kind, kind === 'instrument' ? { preset: 'piano' } : {});
    d.tracks.push(t);
    id = t.id;
  });
  useDaw.getState().select({ trackId: id, clipIds: [] });
}

export function copySelectedClips(cut = false) {
  const daw = useDaw.getState();
  const ids = new Set(daw.selection.clipIds);
  const items = daw.project.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)).map((clip) => ({ clip, trackId: t.id })));
  copyClips(items);
  if (cut) deleteSelectedClips();
}

/** Paste copied clips at the playhead, on their original tracks (or the selected track if it fits). */
export function pasteClips() {
  const cb = getCopiedClips();
  if (!cb) return;
  const daw = useDaw.getState();
  const at = Math.max(0, useTransport.getState().position);
  const fresh: string[] = [];
  const singleTrack = new Set(cb.items.map((i) => i.trackId)).size === 1;
  daw.update('Paste clips', (d) => {
    for (const { clip, trackId } of cb.items) {
      const selected = singleTrack ? d.tracks.find((t) => t.id === daw.selection.trackId) : undefined;
      const fits = selected && (clip.type === 'audio' ? selected.kind === 'audio' : selected.kind === d.tracks.find((t) => t.id === trackId)?.kind);
      const target = (fits ? selected : undefined) ?? d.tracks.find((t) => t.id === trackId);
      if (!target) continue;
      d.nextId++;
      const copy = { ...structuredClone(clip), id: `c${d.nextId}`, start: at + clip.start };
      delete copy.aiPending;
      target.clips.push(copy);
      fresh.push(copy.id);
    }
  });
  daw.select({ clipIds: fresh });
  useTransport.getState().setPosition(at + cb.span);
}

/** Split the selected clips (or the selected track's clip under the playhead) at the playhead. */
export function splitAtPlayhead() {
  const daw = useDaw.getState();
  const at = useTransport.getState().position;
  const ids = new Set(daw.selection.clipIds);
  const bpm = (id: string) => getSampleMeta(id)?.bpm;
  daw.update('Split clips', (d) => {
    for (const t of d.tracks) {
      const targets = t.clips.filter((c) => (ids.size ? ids.has(c.id) : t.id === daw.selection.trackId) && c.start < at - 1e-6 && c.start + c.length > at + 1e-6);
      for (const c of targets) {
        const right = sliceClip(d, c, at, c.start + c.length, bpm);
        const left = sliceClip(d, c, c.start, at, bpm);
        if (!right || !left) continue;
        t.clips = t.clips.filter((x) => x.id !== c.id);
        t.clips.push({ ...left, id: c.id }, right);
      }
    }
  });
}

/**
 * Put a library sample on the timeline at `beat`: on `trackId` if it is an audio track,
 * else on a new audio track. Shared by drag-and-drop and the browser's add button, which
 * is how touch screens place sounds.
 */
export function placeSample(sampleId: string, trackId: string | null, beat: number): string | null {
  const meta = getSampleMeta(sampleId);
  if (!meta) return null;
  const daw = useDaw.getState();
  let clipId = '';
  let placedOn = '';
  daw.update(`Place ${meta.name}`, (d) => {
    let t = trackId ? d.tracks.find((x) => x.id === trackId && x.kind === 'audio') : undefined;
    if (!t) { t = createTrack(d, 'audio', { name: meta.name.slice(0, 24) }); d.tracks.push(t); }
    const len = meta.bpm ? (meta.duration * meta.bpm) / 60 : secondsToBeats(d, meta.duration);
    const c = createAudioClip(d, sampleId, Math.max(0, beat), len, meta.name);
    if (meta.bpm && Math.abs(meta.bpm - d.bpm) > 0.01) c.warp = meta.category === 'loop' || meta.category === 'guitar' || meta.category === 'keys' ? 'stretch' : 'resample';
    t.clips.push(c);
    clipId = c.id;
    placedOn = t.id;
  });
  daw.select({ clipIds: [clipId], trackId: placedOn });
  return clipId;
}
