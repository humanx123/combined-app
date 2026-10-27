import { create } from 'zustand';
import { del, get as idbGet, setMany, update as idbUpdate } from 'idb-keyval';
import type { Project } from '../model/types';
import { createProject } from '../model/project';
import { useDaw } from './store';
import { useAuth, saveProjectToCloud, syncProjectSamples, listCloudProjects, loadCloudProject, deleteCloudProject, watchCloudProjects, cloudUpdatedAt, type CloudProjectChange } from '../cloud/cloud';
import { startPrefsSync, trackLocalPrefChanges } from '../cloud/prefs';
import { useAgent } from '../agent/agent';

// Local-first persistence. Every change autosaves to IndexedDB; when signed in,
// projects sync both ways with Firestore and preferences follow the account.

export interface ProjectEntry { id: string; name: string; updatedAt: number; where: 'local' | 'cloud' | 'both' }

interface PersistState {
  projects: ProjectEntry[];
  saveState: 'saved' | 'saving' | 'unsaved' | 'error';
  refresh: () => Promise<void>;
}

const INDEX = 'vibe:projects';
const LAST = 'vibe:lastProject';
const key = (id: string) => `vibe:project:${id}`;

export const usePersist = create<PersistState>((set) => ({
  projects: [],
  saveState: 'saved',
  refresh: async () => {
    const local = (await idbGet<ProjectEntry[]>(INDEX).catch(() => undefined)) ?? [];
    let cloud: { id: string; name: string; updatedAt: number }[] = [];
    try { cloud = await listCloudProjects(); } catch { /* offline or signed out */ }
    const map = new Map<string, ProjectEntry>(local.map((e) => [e.id, { ...e, where: 'local' }]));
    for (const c of cloud) {
      const have = map.get(c.id);
      map.set(c.id, have ? { ...have, updatedAt: Math.max(have.updatedAt, c.updatedAt), where: 'both' } : { ...c, where: 'cloud' });
    }
    set({ projects: [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt) });
  },
}));

let localQueue: Promise<void> = Promise.resolve();
function serializeLocal(fn: () => Promise<void>) {
  const result = localQueue.then(fn, fn);
  localQueue = result.catch(() => undefined);
  return result;
}

function writeLocal(p: Project, opts: { open?: boolean } = { open: true }) {
  return serializeLocal(async () => {
    const index = (await idbGet<ProjectEntry[]>(INDEX)) ?? [];
    const next = [{ id: p.id, name: p.name, updatedAt: p.updatedAt, where: 'local' as const }, ...index.filter((e) => e.id !== p.id)];
    // Commit the document, index and last-opened pointer together.
    await setMany([[key(p.id), p], [INDEX, next], ...(opts.open ? [[LAST, p.id] as [string, string]] : [])]);
  });
}

function removeLocal(id: string) {
  return serializeLocal(async () => {
    await del(key(id));
    await idbUpdate<ProjectEntry[]>(INDEX, (index) => (index ?? []).filter((e) => e.id !== id));
  });
}

let localTimer: ReturnType<typeof setTimeout> | undefined;
let cloudTimer: ReturnType<typeof setTimeout> | undefined;
let maxTimer: ReturnType<typeof setTimeout> | undefined;
let autosaveCleanup: (() => void) | undefined;
let savedProject: Project | null = null;
// Project objects known to be identical to the cloud's copy, so loading one isn't uploaded back.
const cloudCopies = new WeakSet<Project>();
let saveInFlight: Promise<void> | null = null;

/** Save pending edits before navigation; a completed older save must not mark newer edits saved. */
export function flushAutosave(): Promise<void> {
  clearTimeout(localTimer);
  clearTimeout(maxTimer);
  maxTimer = undefined;
  if (saveInFlight) return saveInFlight;
  if (savedProject === useDaw.getState().project) return Promise.resolve();
  saveInFlight = (async () => {
    usePersist.setState({ saveState: 'saving' });
    try {
      while (savedProject !== useDaw.getState().project) {
        const p = useDaw.getState().project;
        await writeLocal(p);
        savedProject = p;
      }
      usePersist.setState({ saveState: 'saved' });
    } catch (e) {
      usePersist.setState({ saveState: 'error' });
      throw e;
    } finally { saveInFlight = null; }
  })();
  return saveInFlight;
}

export function startAutosave() {
  if (autosaveCleanup) return autosaveCleanup;
  const save = () => { void flushAutosave().catch((e) => console.error('Autosave failed', e)); };
  const unsubscribe = useDaw.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    usePersist.setState({ saveState: 'unsaved' });
    clearTimeout(localTimer);
    localTimer = setTimeout(save, 700);
    // Continuous dragging/typing must not postpone saving indefinitely.
    maxTimer ??= setTimeout(save, 5000);
    clearTimeout(cloudTimer);
    // Skip the echo when the change is the cloud's own copy (opened or synced from another device).
    if (useAuth.getState().user && !cloudCopies.has(s.project)) {
      const p = s.project;
      cloudTimer = setTimeout(() => { saveProjectToCloud(p).catch((e) => console.warn('Cloud save failed', e)); }, 4000);
    }
  });
  const hidden = () => { if (document.visibilityState === 'hidden') save(); };
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', hidden);
  autosaveCleanup = () => {
    unsubscribe();
    clearTimeout(localTimer);
    clearTimeout(cloudTimer);
    clearTimeout(maxTimer);
    maxTimer = undefined;
    window.removeEventListener('pagehide', save);
    document.removeEventListener('visibilitychange', hidden);
    autosaveCleanup = undefined;
  };
  return autosaveCleanup;
}

export async function loadInitialProject(): Promise<Project> {
  try {
    const last = await idbGet<string>(LAST);
    if (last) {
      const p = await idbGet<Project>(key(last));
      if (p) return p;
    }
  } catch (e) {
    console.warn('Could not read saved projects', e);
  }
  return createProject();
}

export async function openProject(id: string) {
  await flushAutosave();
  let p = await idbGet<Project>(key(id)).catch(() => undefined);
  if (useAuth.getState().user) {
    try {
      const remote = await loadCloudProject(id);
      if (remote && (!p || remote.updatedAt > p.updatedAt)) p = remote;
    } catch (e) {
      console.warn('Cloud load failed', e);
    }
  }
  if (!p) throw new Error('Project not found');
  if (cloudUpdatedAt(p.id) === p.updatedAt) cloudCopies.add(p);
  await flushAutosave();
  useAgent.getState().clear();
  useDaw.getState().replaceProject(p);
  await flushAutosave();
}

export async function newProject(name?: string) {
  await flushAutosave();
  const p = createProject(name);
  useAgent.getState().clear();
  useDaw.getState().replaceProject(p);
  await flushAutosave();
  await usePersist.getState().refresh();
}

export async function duplicateProject() {
  await flushAutosave();
  const cur = useDaw.getState().project;
  const p: Project = { ...structuredClone(cur), id: createProject().id, name: `${cur.name} (copy)`, createdAt: Date.now(), updatedAt: Date.now() };
  useAgent.getState().clear();
  useDaw.getState().replaceProject(p);
  await flushAutosave();
  await usePersist.getState().refresh();
}

export async function deleteProject(id: string) {
  clearTimeout(cloudTimer);
  if (useDaw.getState().project.id === id) {
    // Switch first so a queued autosave cannot recreate the deleted project.
    useAgent.getState().clear();
    useDaw.getState().replaceProject(createProject());
    await flushAutosave();
  }
  await removeLocal(id);
  try { await deleteCloudProject(id); } catch { /* not in cloud */ }
  await usePersist.getState().refresh();
}

export async function syncNow() {
  await saveProjectToCloud(useDaw.getState().project);
  await usePersist.getState().refresh();
}

// ---------------------------------------------------------------- account sync

// Project ids this device has seen in the account's cloud. A synced id that later goes
// missing from the cloud was deleted on another device, so it is removed here too
// instead of being re-uploaded.
const SYNCED = (uid: string) => `vibe:synced:${uid}`;
// Which account each cached project came from, so switching Google accounts in one
// browser never uploads the first account's projects into the second.
const OWNERS = 'vibe:projectOwners';

let syncQueue: Promise<void> = Promise.resolve();
let syncStarted = false;

/** Follow the signed-in account: two-way project sync plus preferences. Call once at boot. */
export function startCloudSync() {
  if (syncStarted) return;
  syncStarted = true;
  trackLocalPrefChanges();
  let uid: string | null | undefined;
  let generation = 0;
  let stop: (() => void) | null = null;
  const follow = async (next: string | null) => {
    if (next === uid) return;
    uid = next;
    const mine = ++generation;
    stop?.();
    stop = null;
    if (!next) { await usePersist.getState().refresh(); return; }
    const stops = await Promise.all([
      startPrefsSync(next).catch((e) => { console.warn('Preference sync failed to start', e); return () => {}; }),
      watchCloudProjects((changes, initial) => {
        syncQueue = syncQueue
          .then(() => applyCloudChanges(next, changes, initial))
          .catch((e) => console.warn('Cloud project sync failed', e));
      }),
    ]);
    if (mine !== generation) { stops.forEach((f) => f()); return; }
    stop = () => stops.forEach((f) => f());
  };
  useAuth.subscribe((s) => { void follow(s.user?.uid ?? null); });
  // A remote update that arrived mid agent run is applied once the run ends.
  useDaw.subscribe((s, prev) => {
    if (prev.transaction && !s.transaction && deferredRemote) {
      const c = deferredRemote;
      deferredRemote = null;
      adoptRemoteCurrent(c);
    }
  });
  void follow(useAuth.getState().user?.uid ?? null);
}

async function applyCloudChanges(uid: string, changes: CloudProjectChange[], initial: boolean) {
  if (useAuth.getState().user?.uid !== uid) return;
  const synced = new Set((await idbGet<string[]>(SYNCED(uid)).catch(() => undefined)) ?? []);
  const owners = (await idbGet<Record<string, string>>(OWNERS).catch(() => undefined)) ?? {};
  const index = (await idbGet<ProjectEntry[]>(INDEX).catch(() => undefined)) ?? [];
  const localById = new Map(index.map((e) => [e.id, e]));
  const current = () => useDaw.getState().project;

  for (const c of changes) {
    if (c.local) continue;
    const id = c.info.id;
    if (c.type === 'removed') {
      // Keep the open project: the next edit puts it back rather than vanishing mid-session.
      // Its id stays in `synced` so an unedited reload doesn't resurrect it.
      if (id === current().id) continue;
      synced.delete(id);
      if (localById.has(id)) await removeLocal(id);
      continue;
    }
    synced.add(id);
    owners[id] = uid;
    if (id === current().id) {
      if (c.info.updatedAt > current().updatedAt) adoptRemoteCurrent(c);
    } else if (!localById.has(id) || c.info.updatedAt > localById.get(id)!.updatedAt) {
      // Keep a local copy so the project opens offline on this device too.
      const p = c.load();
      if (p) await writeLocal(p, { open: false });
    }
  }

  if (initial) {
    const inCloud = new Set(changes.map((c) => c.info.id));
    for (const e of index) {
      if (inCloud.has(e.id)) {
        if (e.updatedAt > (cloudUpdatedAt(e.id) ?? 0)) await uploadLocal(e.id, synced);
        else {
          // Older builds synced the composition without backfilling its audio.
          // Only inspect projects already belonging to this account; never upload
          // another signed-in account's unrelated sample library.
          const p = e.id === current().id ? current() : await idbGet<Project>(key(e.id));
          if (p) await syncProjectSamples(p, true).catch((err) => console.warn('Audio backfill failed', err));
        }
      } else if (synced.has(e.id)) {
        if (e.id !== current().id) { synced.delete(e.id); await removeLocal(e.id); }
      } else if (!owners[e.id] || owners[e.id] === uid) {
        if (await uploadLocal(e.id, synced)) owners[e.id] = uid;
      }
    }
    // A fresh device starts on a blank project; open the newest one from the account instead.
    const cur = current();
    const newest = changes.filter((c) => c.type !== 'removed').sort((a, b) => b.info.updatedAt - a.info.updatedAt)[0];
    if (newest && !inCloud.has(cur.id) && cur.tracks.length === 0 && newest.info.id !== cur.id) {
      try { await openProject(newest.info.id); } catch (e) { console.warn('Could not open cloud project', e); }
    }
  }

  await setMany([[SYNCED(uid), [...synced]], [OWNERS, owners]]).catch(() => undefined);
  await usePersist.getState().refresh();
}

let deferredRemote: CloudProjectChange | null = null;

/** Bring another device's newer copy of the open project in, as an undoable step. */
function adoptRemoteCurrent(c: CloudProjectChange) {
  // Never swap the document under an agent run; retry when it ends.
  if (useDaw.getState().transaction) { deferredRemote = c; return; }
  const p = c.load();
  if (!p) return;
  const cur = useDaw.getState().project;
  if (cur.id !== p.id || p.updatedAt <= cur.updatedAt) return;
  cloudCopies.add(p);
  useDaw.getState().replaceProject(p, { keepHistory: true, label: 'Changes from another device' });
}

async function uploadLocal(id: string, synced: Set<string>): Promise<boolean> {
  const cur = useDaw.getState().project;
  const p = cur.id === id ? cur : await idbGet<Project>(key(id)).catch(() => undefined);
  // Blank projects aren't worth a cloud copy until someone puts something in them.
  if (!p || p.tracks.length === 0) return false;
  try {
    await saveProjectToCloud(p);
    synced.add(id);
    return true;
  } catch (e) {
    console.warn(`Could not upload “${p.name}”`, e);
    return false;
  }
}
