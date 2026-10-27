import { create } from 'zustand';
import { get, set } from 'idb-keyval';
import { PRESET_KINDS, type PresetKind } from '../model/presets';
import type { Project, SampleMeta } from '../model/types';
import { uid } from '../model/project';
import { validateProject } from '../model/validate';

export interface PresetRecord {
  id: string; name: string; kind: PresetKind; tags: string[];
  data: string; updatedAt: number; revision: string; deleted: boolean;
}
export interface PresetPayload { project: Project; samples: SampleMeta[] }
interface PresetState {
  scope: string; ready: boolean; records: Record<string, PresetRecord>; dirty: string[];
  syncing: boolean; error: string | null;
}
const key = (scope: string) => `vibe:presets:${scope}`;
export const usePresets = create<PresetState>(() => ({ scope: 'device', ready: false, records: {}, dirty: [], syncing: false, error: null }));
let generation = 0;
let writes = Promise.resolve();
let notifySync: (() => void) | null = null;
export function setPresetSyncNotifier(notify: (() => void) | null) { notifySync = notify; }

export function comparePresets(a: PresetRecord, b: PresetRecord): number {
  return Number(a.deleted) - Number(b.deleted) || a.updatedAt - b.updatedAt || a.revision.localeCompare(b.revision);
}
export function parsePresetRecord(raw: unknown, id?: string): PresetRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as PresetRecord;
  if (typeof r.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(r.id) || (id && r.id !== id) || !PRESET_KINDS.includes(r.kind) || typeof r.name !== 'string' || !r.name.trim() || r.name.length > 120 || !Array.isArray(r.tags) || r.tags.length > 12 || r.tags.some((t) => typeof t !== 'string' || t.length > 40) || typeof r.data !== 'string' || new TextEncoder().encode(r.data).length > 750_000 || !Number.isFinite(r.updatedAt) || r.updatedAt < 0 || typeof r.revision !== 'string' || !r.revision || r.revision.length > 100 || typeof r.deleted !== 'boolean') return null;
  return { id: r.id, kind: r.kind, name: r.name, tags: r.tags, data: r.data, updatedAt: r.updatedAt, revision: r.revision, deleted: r.deleted };
}

function persist(): Promise<void> {
  const s = usePresets.getState();
  const scope = s.scope, token = generation;
  const value = { records: s.records, dirty: s.dirty };
  const done = writes.then(() => set(key(scope), value));
  writes = done.catch((error) => { if (token === generation) usePresets.setState({ error: `Library could not save locally: ${String(error)}` }); });
  return done;
}

/** Account changes hide the previous library immediately; late reads cannot replace it. */
export async function switchPresetAccount(account: string | null): Promise<void> {
  const token = ++generation, scope = account ? `user:${account}` : 'device';
  notifySync = null;
  usePresets.setState({ scope, ready: false, records: {}, dirty: [], syncing: false, error: null });
  await writes;
  const stored = await get<{ records?: Record<string, unknown>; dirty?: string[] }>(key(scope)).catch(() => undefined);
  if (token !== generation) return;
  const records: Record<string, PresetRecord> = {};
  for (const [id, raw] of Object.entries(stored?.records ?? {})) { const r = parsePresetRecord(raw, id); if (r) records[id] = r; }
  usePresets.setState({ records, dirty: (stored?.dirty ?? []).filter((id) => !!records[id]), ready: true });
}

export function presetPayload(record: PresetRecord): PresetPayload {
  if (record.deleted) throw new Error('This library item was deleted');
  const data = JSON.parse(record.data) as PresetPayload;
  const project = validateProject(data.project);
  if (!Array.isArray(data.samples)) throw new Error('Invalid saved sample metadata');
  for (const m of data.samples) if (!m || typeof m.id !== 'string' || typeof m.name !== 'string' || typeof m.category !== 'string' || !Array.isArray(m.tags) || !Number.isFinite(m.duration) || !['user', 'online', 'generated', 'designed'].includes(m.source)) throw new Error('Invalid saved sample metadata');
  for (const m of data.samples) {
    if (!['oneshot', 'loop'].includes(m.kind) || m.duration < 0 || m.tags.some((t) => typeof t !== 'string')) throw new Error('Invalid saved sample metadata');
    if (m.attribution) {
      const a = m.attribution;
      if (typeof a.author !== 'string' || typeof a.license !== 'string' || ![a.sourceUrl, a.licenseUrl].every((url) => { try { return new URL(url).protocol === 'https:'; } catch { return false; } })) throw new Error('Invalid sample attribution');
    }
  }
  return { project, samples: data.samples };
}

export async function savePreset(name: string, kind: PresetKind, payload: PresetPayload, tags: string[] = []): Promise<PresetRecord> {
  const state = usePresets.getState();
  if (!state.ready) throw new Error('Your library is still opening');
  validateProject(payload.project);
  const record = parsePresetRecord({ id: uid(), name: name.trim(), kind, tags: [...new Set(tags.map((t) => t.trim()).filter(Boolean))], data: JSON.stringify(payload), updatedAt: Date.now(), revision: uid(), deleted: false });
  if (!record) throw new Error('Use a name under 120 characters, up to 12 short tags, and a preset under 750 KB');
  presetPayload(record);
  usePresets.setState({ records: { ...state.records, [record.id]: record }, dirty: [...state.dirty, record.id] });
  await persist(); notifySync?.(); return record;
}

export async function editPreset(id: string, patch: { name?: string; tags?: string[]; deleted?: boolean }): Promise<void> {
  const s = usePresets.getState(), old = s.records[id];
  if (!s.ready || !old || old.deleted) throw new Error('Library item unavailable');
  const record = parsePresetRecord({ ...old, ...patch, ...(patch.deleted ? { data: '' } : {}), updatedAt: Math.max(Date.now(), old.updatedAt + 1), revision: uid() });
  if (!record) throw new Error('Invalid library item');
  usePresets.setState({ records: { ...s.records, [id]: record }, dirty: [...new Set([...s.dirty, id])] });
  await persist(); notifySync?.();
}

/** Tombstones and deterministic revision ordering prevent offline devices reviving deletions. */
export async function mergeRemotePresets(scope: string, remote: PresetRecord[]): Promise<void> {
  const s = usePresets.getState(); if (s.scope !== scope || !s.ready) return;
  const records = { ...s.records }, dirty = new Set(s.dirty);
  for (const r of remote) {
    const local = records[r.id];
    if (!local || comparePresets(r, local) >= 0) { records[r.id] = r; dirty.delete(r.id); }
    else dirty.add(r.id);
  }
  usePresets.setState({ records, dirty: [...dirty] });
  await persist();
}

export async function copyDevicePresetsToAccount(): Promise<number> {
  const state = usePresets.getState();
  if (!state.scope.startsWith('user:') || !state.ready) throw new Error('Sign in first');
  const scope = state.scope;
  const guest = await get<{ records: Record<string, unknown> }>(key('device'));
  if (usePresets.getState().scope !== scope) throw new Error('Account changed');
  let count = 0;
  for (const [id, raw] of Object.entries(guest?.records ?? {})) {
    const record = parsePresetRecord(raw, id);
    if (record && !record.deleted) { await savePreset(record.name, record.kind, presetPayload(record), record.tags); count++; }
    if (usePresets.getState().scope !== scope) throw new Error('Account changed');
  }
  return count;
}
