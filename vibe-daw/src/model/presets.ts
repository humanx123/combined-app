import { selectionAnnotations } from './annotations';
import type { Effect, Project, Track } from './types';
import type { EditSelection } from './selection';
import { selectedNotes, selectionClips } from './selection';
import { cloneDeep, createProject, findEffect, mintId, uid } from './project';
import { sliceClip } from './edit';

export const PRESET_KINDS = ['clip', 'sound', 'effects', 'template'] as const;
export type PresetKind = typeof PRESET_KINDS[number];

/** Small project documents reuse the normal validation and audio dependency model. */
export function capturePreset(project: Project, kind: PresetKind, options: { trackId?: string; effectId?: string; selection?: EditSelection; sampleBpm?: (id: string) => number | undefined } = {}): Project {
  const result = createProject();
  result.bpm = project.bpm; result.key = { ...project.key }; result.timeSignature = [...project.timeSignature]; result.swing = project.swing;
  result.nextId = project.nextId; result.master.effects = [];
  const source = project.tracks.find((t) => t.id === options.trackId);
  if (kind === 'template') return clean(cloneDeep(project));
  if (kind === 'effects' && options.effectId) {
    const found = findEffect(project, options.effectId);
    if (!found) throw new Error('That effect no longer exists');
    result.master.effects = [cloneDeep(found.effect)];
  } else if (kind === 'effects') {
    const effects = options.trackId === 'master' ? project.master.effects : source?.effects;
    if (!effects?.length) throw new Error('Choose a track or master with effects to save');
    result.master.effects = cloneDeep(effects);
  } else if (kind === 'sound') {
    if (!source) throw new Error('Choose a track sound to save');
    result.tracks = [{ ...cloneDeep(source), clips: [], mute: false, solo: false }];
  } else {
    const selection = options.selection;
    if (!selection) throw new Error('Select clips or a region to save');
    const ids = new Set(selectionClips(project, selection));
    for (const t of project.tracks) {
      const clips = t.clips.filter((c) => ids.has(c.id)).map((c) => {
        let copy = cloneDeep(c);
        if (c.type === 'midi' && selection.notes?.some((n) => n.clipId === c.id)) copy = { ...c, notes: cloneDeep(selectedNotes(project, selection, c.id)) };
        return selection.range ? sliceClip(result, copy, selection.range.start, selection.range.end, options.sampleBpm) : copy;
      }).filter((c): c is NonNullable<typeof c> => !!c);
      if (clips.length) result.tracks.push({ ...cloneDeep(t), clips, mute: false, solo: false });
    }
    if (!result.tracks.length) throw new Error('Select at least one clip to save');
    const origin = Math.min(...result.tracks.flatMap((t) => t.clips.map((c) => c.start)));
    const end = Math.max(...result.tracks.flatMap((t) => t.clips.map((c) => c.start + c.length)));
    result.annotations = selectionAnnotations(project, selection).map((a) => ({ ...cloneDeep(a), start: Math.max(a.start, origin) - origin, length: Math.min(a.start + a.length, end) - Math.max(a.start, origin) })).filter((a) => a.length > 0);
    for (const t of result.tracks) for (const c of t.clips) c.start -= origin;
  }
  return clean(result);
}

function clean(project: Project): Project {
  for (const t of project.tracks) for (const c of t.clips) delete c.aiPending;
  for (const a of project.annotations ?? []) delete a.aiPending;
  return project;
}

/** Never preserve external sidechain IDs: the destination may have an unrelated t1. */
function copyEffects(project: Project, effects: Effect[], tracks: Map<string, string>): Effect[] {
  return effects.map((effect) => {
    const e = { ...cloneDeep(effect), id: mintId(project, 'fx') };
    if (e.type === 'duck') {
      const source = tracks.get(String(e.params.source));
      e.params.source = source ?? '';
      if (!source) e.enabled = false;
    }
    return e;
  });
}

export function insertPreset(project: Project, saved: Project, kind: Exclude<PresetKind, 'template'>, options: { at?: number; targetTrackId?: string; replaceEffects?: boolean } = {}) {
  const trackIds: string[] = [], clipIds: string[] = [];
  const at = Math.max(0, options.at ?? 0);
  if (!Number.isFinite(at)) throw new Error('Preset position must be finite');
  const target = project.tracks.find((t) => t.id === options.targetTrackId);
  if (kind === 'effects') {
    const list = options.targetTrackId === 'master' ? project.master.effects : target?.effects;
    if (!list) throw new Error('Choose a destination track or master for this effect profile');
    const effects = copyEffects(project, saved.master.effects, new Map());
    if (options.replaceEffects) list.splice(0, list.length, ...effects);
    else {
      const end = options.targetTrackId === 'master' && list.at(-1)?.type === 'limiter' ? list.length - 1 : list.length;
      list.splice(end, 0, ...effects);
    }
    return { trackIds, clipIds };
  }
  if (target && (saved.tracks.length !== 1 || target.kind !== saved.tracks[0].kind)) throw new Error('This preset needs a matching track type; add it as a new track instead');
  const remap = new Map(saved.tracks.map((t) => [t.id, target?.id ?? mintId(project, 't')]));
  for (const original of saved.tracks) {
    const t: Track = { ...cloneDeep(original), id: remap.get(original.id)!, mute: false, solo: false };
    t.effects = copyEffects(project, original.effects, remap);
    t.drumLanes = original.drumLanes?.map((l) => ({ ...cloneDeep(l), id: mintId(project, 'ln') }));
    t.clips = original.clips.map((c) => {
      const clip = { ...cloneDeep(c), id: mintId(project, 'c'), start: c.start + at };
      delete clip.aiPending;
      if (clip.type === 'midi') clip.notes = clip.notes.map((n) => ({ ...n, id: uid() }));
      clipIds.push(clip.id); return clip;
    });
    if (target) {
      if (kind === 'sound') { target.instrument = t.instrument; target.drumLanes = t.drumLanes; target.effects = t.effects; }
      target.clips.push(...t.clips);
    } else project.tracks.push(t);
    trackIds.push(t.id);
  }
  if (kind === 'clip') for (const a of saved.annotations ?? []) {
    const annotation = { ...cloneDeep(a), id: mintId(project, 'a'), start: a.start + at, trackId: a.trackId ? remap.get(a.trackId) : undefined };
    delete annotation.aiPending;
    (project.annotations ??= []).push(annotation);
  }
  return { trackIds, clipIds };
}
