import { capturePreset, insertPreset, type PresetKind } from '../model/presets';
import { createAudioClip, createProject, createTrack, secondsToBeats } from '../model/project';
import { getSampleMeta, loadBuffer, mergeRemoteSamples } from '../samples/library';
import { savePreset, presetPayload, usePresets, type PresetRecord } from '../state/presetLibrary';
import { useDaw, useTransport } from '../state/store';
import type { EditSelection } from '../model/selection';
import type { Project } from '../model/types';
import { flushAutosave, usePersist } from '../state/persistence';
import { stop } from '../engine/api';
import { useAgent } from '../agent/agent';

function sampleIds(p: Project) {
  return [...new Set(p.tracks.flatMap((t) => [...(t.drumLanes?.map((l) => l.sampleId) ?? []), ...t.clips.flatMap((c) => c.type === 'audio' ? [c.sampleId] : [])]))];
}
export async function saveToLibrary(kind: PresetKind, name: string, options: { trackId?: string; effectId?: string; sampleId?: string; tags?: string[]; selection?: EditSelection } = {}) {
  const { project, selection } = useDaw.getState();
  const scope = usePresets.getState().scope;
  let captured: Project;
  if (options.sampleId) {
    if (kind !== 'sound') throw new Error('A sample can only be saved as a sound');
    const sample = getSampleMeta(options.sampleId);
    if (!sample || !await loadBuffer(sample.id)) throw new Error('Sound unavailable');
    if (usePresets.getState().scope !== scope) throw new Error('Account changed');
    captured = createProject(sample.name); captured.bpm = sample.bpm ?? project.bpm;
    const t = createTrack(captured, 'audio', { name: sample.name });
    t.clips.push(createAudioClip(captured, sample.id, 0, Math.max(0.25, secondsToBeats(captured, sample.duration)), sample.name));
    captured.tracks.push(t); captured.master.effects = [];
  } else captured = capturePreset(project, kind, { trackId: options.trackId ?? selection.trackId ?? undefined, effectId: options.effectId, selection: options.selection ?? selection, sampleBpm: (id) => getSampleMeta(id)?.bpm });
  for (const id of sampleIds(captured)) if (!getSampleMeta(id)) throw new Error(`Sample metadata is missing for ${id}; load the sound before saving it`);
  const samples = sampleIds(captured).map((id) => getSampleMeta(id)).filter((m): m is NonNullable<typeof m> => !!m && m.source !== 'builtin');
  // A lone custom effect is a plugin: tagged so the Add effect menu can offer it.
  const plugin = kind === 'effects' && captured.master.effects.length === 1 && captured.master.effects[0].type === 'custom';
  return savePreset(name, kind, { project: captured, samples }, plugin ? [PLUGIN_TAG, ...(options.tags ?? []).filter((t) => t !== PLUGIN_TAG)] : options.tags);
}

export const PLUGIN_TAG = 'plugin';

/** Saved plugins: library effect items holding exactly one custom effect. */
export function libraryPlugins(records: Record<string, PresetRecord>): PresetRecord[] {
  return Object.values(records).filter((r) => !r.deleted && r.kind === 'effects' && r.tags.includes(PLUGIN_TAG)).sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadFromLibrary(record: PresetRecord, options: { targetTrackId?: string; replaceEffects?: boolean; at?: number } = {}) {
  const scope = usePresets.getState().scope;
  const current = useDaw.getState().project.id;
  const { project, samples } = presetPayload(record);
  const account = scope.startsWith('user:') ? scope.slice(5) : null;
  const metadata = samples.map((m) => ({ ...m, storagePath: account ? `users/${account}/samples/${m.id}` : undefined }));
  mergeRemoteSamples(metadata);
  for (const id of sampleIds(project)) if (!await loadBuffer(id)) throw new Error(`“${getSampleMeta(id)?.name ?? id}” is unavailable. Let the original device finish syncing its audio.`);
  if (scope !== usePresets.getState().scope || current !== useDaw.getState().project.id) throw new Error('Account or project changed while loading the library item');
  if (record.kind === 'template') {
    if (useDaw.getState().transaction) throw new Error('Stop the Producer before opening a project template');
    await flushAutosave();
    if (scope !== usePresets.getState().scope || current !== useDaw.getState().project.id) throw new Error('Project changed');
    stop(true); useAgent.getState().clear();
    const p = { ...structuredClone(project), id: createProject().id, name: record.name, createdAt: Date.now(), updatedAt: Date.now() };
    useDaw.getState().replaceProject(p);
    await flushAutosave(); await usePersist.getState().refresh();
    return { trackIds: p.tracks.map((t) => t.id), clipIds: p.tracks.flatMap((t) => t.clips.map((c) => c.id)) };
  }
  let added = { trackIds: [] as string[], clipIds: [] as string[] };
  useDaw.getState().update(`Load ${record.name}`, (p) => {
    added = insertPreset(p, project, record.kind as Exclude<PresetKind, 'template'>, { ...options, at: options.at ?? useTransport.getState().position });
  });
  useDaw.getState().select({ trackId: added.trackIds[0] ?? useDaw.getState().selection.trackId, clipIds: added.clipIds });
  if (added.clipIds[0]) useDaw.getState().openEditor(added.clipIds[0]);
  return added;
}
