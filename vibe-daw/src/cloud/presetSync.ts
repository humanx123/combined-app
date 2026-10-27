import { getFirebaseApp } from './firebase';
import { syncProjectSamples, useAuth } from './cloud';
import { comparePresets, mergeRemotePresets, parsePresetRecord, presetPayload, setPresetSyncNotifier, switchPresetAccount, usePresets, type PresetRecord } from '../state/presetLibrary';

let started = false;
let retry: (() => void) | null = null;
/** Library records and audio are owned by one UID; never publish another scope's queue. */
export function startPresetSync() {
  if (started) return;
  started = true;
  let generation = 0;
  let stop: (() => void) | null = null;
  const follow = async (uid: string | null) => {
    const token = ++generation;
    stop?.(); stop = null; setPresetSyncNotifier(null);
    const scope = uid ? `user:${uid}` : 'device';
    if (usePresets.getState().scope !== scope || !usePresets.getState().ready) await switchPresetAccount(uid);
    if (!uid || token !== generation) return;
    const isCurrent = () => token === generation && useAuth.getState().user?.uid === uid && usePresets.getState().scope === scope;
    try {
      const app = await getFirebaseApp();
      if (!app || !isCurrent()) return;
      const { collection, doc, getFirestore, onSnapshot, runTransaction } = await import('firebase/firestore');
      if (!isCurrent()) return;
      const db = getFirestore(app);
      let serverReady = false, running = false, stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const active = () => !stopped && isCurrent();
      const flush = async () => {
        if (!active() || !serverReady || running) return;
        running = true; usePresets.setState({ syncing: true });
        const attempted = new Set<string>();
        try {
          while (active()) {
            const state = usePresets.getState();
            const id = state.dirty.find((id) => { const r = state.records[id]; return r && !attempted.has(`${id}:${r.revision}`); });
            if (!id) break;
            const record = state.records[id]; attempted.add(`${id}:${record.revision}`);
            if (!record.deleted) await syncProjectSamples(presetPayload(record).project, false, uid);
            if (!active()) break;
            const ref = doc(db, 'users', uid, 'library', id);
            const winner = await runTransaction(db, async (tx) => {
              const snap = await tx.get(ref);
              if (!active()) throw new Error('Account changed during library sync');
              const remote = snap.exists() ? parsePresetRecord(snap.data(), id) : null;
              if (remote && comparePresets(remote, record) >= 0) return remote;
              tx.set(ref, record);
              return record;
            });
            if (active()) await mergeRemotePresets(scope, [winner]);
          }
          if (active()) usePresets.setState({ error: null });
        } catch (e) {
          if (active()) usePresets.setState({ error: `Library sync failed: ${(e as Error).message}. Your items remain on this device.` });
        } finally {
          running = false;
          if (active()) usePresets.setState({ syncing: false });
        }
      };
      const schedule = () => { if (active()) { clearTimeout(timer); timer = setTimeout(() => void flush(), 500); } };
      const unsubscribe = onSnapshot(collection(db, 'users', uid, 'library'), { includeMetadataChanges: true }, (snap) => {
        if (!active() || snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;
        serverReady = true;
        const records = snap.docs.map((d) => parsePresetRecord(d.data(), d.id)).filter((r): r is PresetRecord => !!r);
        void mergeRemotePresets(scope, records).then(schedule).catch((e) => { if (active()) usePresets.setState({ error: String(e) }); });
      }, (e) => { if (active()) usePresets.setState({ error: `Library sync unavailable: ${e.message}` }); });
      const online = () => { if (active()) void flush(); };
      globalThis.addEventListener?.('online', online);
      setPresetSyncNotifier(schedule);
      stop = () => { stopped = true; clearTimeout(timer); unsubscribe(); globalThis.removeEventListener?.('online', online); };
    } catch (e) { if (isCurrent()) usePresets.setState({ error: `Library sync unavailable: ${(e as Error).message}` }); }
  };
  retry = () => { void follow(useAuth.getState().user?.uid ?? null); };
  useAuth.subscribe((s, prev) => { if (s.user?.uid !== prev.user?.uid) void follow(s.user?.uid ?? null); });
  void follow(useAuth.getState().user?.uid ?? null);
}

export function retryPresetSync() {
  // Wake the same notifier used for durable local edits; online events also retry.
  retry?.();
}
