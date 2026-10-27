import type { Project, SampleMeta } from '../model/types';
import { validateProject } from '../model/validate';
import { createProject } from '../model/project';
import { addSample, decodeAudio, getSampleBytes, getSampleMeta, updateSampleMeta } from '../samples/library';
import { arrayBufferToBase64, base64ToArrayBuffer } from '../engine/wav';
import { useDaw } from './store';
import { flushAutosave, usePersist } from './persistence';
import { useAgent } from '../agent/agent';
import { stop } from '../engine/api';

interface PackedSample { meta: SampleMeta; mime: string; data: string }
export interface ProjectFile { format: 'vibe-project'; version: 1; project: Project; samples: PackedSample[] }

function sampleIds(p: Project): Set<string> {
  const ids = new Set<string>();
  for (const t of p.tracks) {
    for (const l of t.drumLanes ?? []) ids.add(l.sampleId);
    for (const c of t.clips) if (c.type === 'audio') ids.add(c.sampleId);
  }
  return ids;
}

/** Portable session with only referenced custom audio; no credentials or chat history. */
export async function exportProjectFile(project: Project): Promise<Blob> {
  const samples: PackedSample[] = [];
  for (const id of sampleIds(project)) {
    const meta = getSampleMeta(id);
    if (meta?.source === 'builtin') continue;
    if (!meta) throw new Error(`Missing sample metadata: ${id}`);
    const bytes = await getSampleBytes(id);
    if (!bytes) throw new Error(`Could not pack sample "${meta.name}". Load it and try again.`);
    // Cloud paths belong to the exporting account, not the recipient.
    const { storagePath: _path, ...portable } = meta;
    void _path;
    samples.push({ meta: portable, mime: bytes.mime, data: arrayBufferToBase64(bytes.data) });
  }
  const file: ProjectFile = { format: 'vibe-project', version: 1, project, samples };
  return new Blob([JSON.stringify(file)], { type: 'application/json' });
}

export function parseProjectFile(text: string): ProjectFile {
  const raw: unknown = JSON.parse(text);
  if (!raw || typeof raw !== 'object') throw new Error('Not a Vibe project file.');
  const file = raw as Record<string, unknown>;
  if (file.format !== 'vibe-project' || file.version !== 1 || !Array.isArray(file.samples)) throw new Error('Unsupported Vibe project file.');
  const project = validateProject(file.project);
  const ids = new Set<string>();
  for (const entry of file.samples) {
    const s = entry as PackedSample | null;
    if (!s || !s.meta || typeof s.meta.id !== 'string' || typeof s.meta.name !== 'string' || typeof s.meta.category !== 'string' || !Array.isArray(s.meta.tags) || !s.meta.tags.every((t) => typeof t === 'string') || !['user', 'generated', 'designed', 'online'].includes(s.meta.source) || !['loop', 'oneshot'].includes(s.meta.kind) || typeof s.mime !== 'string' || typeof s.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s.data) || s.data.length % 4 !== 0 || ids.has(s.meta.id)) throw new Error('Invalid sample in project file.');
    if (s.meta.attribution) {
      const a = s.meta.attribution;
      if (typeof a.author !== 'string' || typeof a.license !== 'string' || ![a.sourceUrl, a.licenseUrl].every((url) => { try { return new URL(url).protocol === 'https:'; } catch { return false; } })) throw new Error('Invalid sample attribution.');
    }
    for (const k of ['bpm', 'rootNote', 'duration'] as const) if (s.meta[k] !== undefined && (typeof s.meta[k] !== 'number' || !Number.isFinite(s.meta[k]))) throw new Error(`Invalid sample ${k}.`);
    ids.add(s.meta.id);
  }
  for (const id of sampleIds(project)) if (!ids.has(id) && getSampleMeta(id)?.source !== 'builtin') throw new Error(`Project file is missing audio for sample ${id}.`);
  return { format: 'vibe-project', version: 1, project, samples: file.samples };
}

export async function importProjectFile(text: string): Promise<Project> {
  const file = parseProjectFile(text);
  const project = structuredClone(file.project);
  // Decode everything before modifying the library or replacing the session.
  const decoded = [];
  for (const s of file.samples) {
    const data = base64ToArrayBuffer(s.data);
    decoded.push({ sample: s, data, buffer: await decodeAudio(data) });
  }
  await flushAutosave();
  const remap = new Map<string, string>();
  for (const { sample: { meta, mime }, data, buffer } of decoded) {
    const added = await addSample({ ...meta, skipAnalysis: true }, { data, mime }, buffer);
    updateSampleMeta(added.id, { rootNote: meta.rootNote, aiDescription: meta.aiDescription, aiDescriptionAudio: meta.aiDescriptionAudio });
    remap.set(meta.id, added.id);
  }
  for (const t of project.tracks) {
    for (const l of t.drumLanes ?? []) l.sampleId = remap.get(l.sampleId) ?? l.sampleId;
    for (const c of t.clips) if (c.type === 'audio') c.sampleId = remap.get(c.sampleId) ?? c.sampleId;
  }
  // Import as a separate project so opening a shared file cannot overwrite a local session.
  project.id = createProject().id;
  project.updatedAt = Date.now();
  await flushAutosave();
  stop(true);
  useAgent.getState().clear();
  useDaw.getState().replaceProject(project);
  await flushAutosave();
  await usePersist.getState().refresh();
  return project;
}
