import { create } from 'zustand';
import type { User } from 'firebase/auth';
import type { Project, SampleMeta } from '../model/types';
import { getFirebaseApp } from './firebase';
import { firebaseConfigured } from './config';
import { mergeRemoteSamples, setRemoteSampleFetcher, setRemoteSampleUploader, syncSamples } from '../samples/library';
import { legalReceipt, requestLegalAcceptance } from '../legal/acceptance';
import { useLegalConsent } from '../legal/acceptance';
import { isNativeApp, nativeAuthCredential, postToNative, startNativeSession } from '../native/native-bridge';

// Firebase-backed sync: Google sign-in, projects in Firestore, sample audio in Storage.
// Everything is scoped under users/{uid} and locked down by the rules in firestore.rules
// and storage.rules.

export interface CloudProjectInfo { id: string; name: string; updatedAt: number }

interface AuthState {
  user: { uid: string; name: string | null; email: string | null; photo: string | null } | null;
  ready: boolean;
  syncing: boolean;
  lastSyncError: string | null;
  sampleSyncError: string | null;
  syncingAudio: boolean;
}

export const useAuth = create<AuthState>(() => ({ user: null, ready: !firebaseConfigured, syncing: false, lastSyncError: null, sampleSyncError: null, syncingAudio: false }));

let currentUser: User | null = null;

export async function initCloud() {
  const app = await getFirebaseApp();
  if (!app) return;
  const { getAuth, onAuthStateChanged } = await import('firebase/auth');
  const auth = getAuth(app);
  if(isNativeApp()) void startNativeSession(auth);
  let stopSamples: (() => void) | undefined;
  onAuthStateChanged(auth, (u) => {
    stopSamples?.();
    stopSamples = undefined;
    sampleErrors.clear();
    useAuth.setState({ sampleSyncError: null });
    currentUser = u;
    useAuth.setState({
      ready: true,
      user: u ? { uid: u.uid, name: u.displayName, email: u.email, photo: u.photoURL } : null,
    });
    if (u) void watchSampleIndex(u.uid).then((stop) => {
      if (currentUser?.uid === u.uid) stopSamples = stop;
      else stop();
    }).catch((e) => { if (currentUser?.uid === u.uid) sampleError('index', e); });
  });
  setRemoteSampleFetcher(fetchSampleBytes);
  setRemoteSampleUploader(uploadSample);
}

export async function signIn() {
  if (!await requestLegalAcceptance()) return;
  const app = await getFirebaseApp();
  if (!app) throw new Error('Cloud sync isn’t configured for this build.');
  const { getAuth, GoogleAuthProvider, OAuthProvider, signInWithPopup, signInWithCredential } = await import('firebase/auth');
  const provider = useLegalConsent.getState().provider;
  const result = isNativeApp()
    ? await signInWithCredential(getAuth(app), (await nativeAuthCredential(provider)).credential)
    : await signInWithPopup(getAuth(app), provider === 'apple' ? new OAuthProvider('apple.com') : new GoogleAuthProvider());
  const { doc, setDoc, serverTimestamp } = await import('firebase/firestore');
  await setDoc(doc(await db(), 'users', result.user.uid, 'legal', 'current'), { ...legalReceipt(), acceptedAt: serverTimestamp() });
}

export async function signOut() {
  const app = await getFirebaseApp();
  if (!app) return;
  const { getAuth, signOut: so } = await import('firebase/auth');
  await so(getAuth(app));
  postToNative({type:'AUTH_TOKEN_CLEAR'});
}

export async function deleteAccount() {
  const app = await getFirebaseApp();
  if (!app || !currentUser) return;
  const uid = currentUser.uid;
  const { getAuth } = await import('firebase/auth');
  const { deleteOwnAccount } = await import('../native/delete-account');
  await deleteOwnAccount(getAuth(app), await db(), {
    collections: ['projects', 'samples', 'library'], documents: ['legal/current', 'prefs/main'],
    stopSync: () => useAuth.setState({user:null}),
    storage: async () => {
      const {getStorage,ref,listAll,deleteObject}=await import('firebase/storage');
      const files=await listAll(ref(getStorage(app),`users/${uid}/samples`));
      for (const file of files.items) await deleteObject(file);
    },
  });
  const {useSettings}=await import('../state/settings');
  useSettings.getState().set({apiKey:'',customInstructions:''});
}

async function db() {
  const app = await getFirebaseApp();
  const { getFirestore } = await import('firebase/firestore');
  return getFirestore(app!);
}

// ---------------------------------------------------------------- projects

export async function saveProjectToCloud(p: Project): Promise<void> {
  if (!currentUser) return;
  const uid = currentUser.uid;
  useAuth.setState({ syncing: true });
  try {
    const { doc, setDoc } = await import('firebase/firestore');
    const data = JSON.stringify(p);
    if (data.length > 900_000) throw new Error('Project too large for cloud sync (over ~900 KB). It is still saved on this device.');
    await syncProjectSamples(p, false, uid);
    if (currentUser?.uid !== uid) throw new Error('Account changed while syncing. Please try again.');
    await setDoc(doc(await db(), 'users', uid, 'projects', p.id), { name: p.name, updatedAt: p.updatedAt, bpm: p.bpm, data, schemaVersion: p.schemaVersion });
    useAuth.setState({ lastSyncError: null });
  } catch (e) {
    useAuth.setState({ lastSyncError: (e as Error).message });
    throw e;
  } finally {
    useAuth.setState({ syncing: false });
  }
}

export async function listCloudProjects(): Promise<CloudProjectInfo[]> {
  if (!currentUser) return [];
  if (cloudIndex) return [...cloudIndex.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  const { collection, getDocs, orderBy, query, limit } = await import('firebase/firestore');
  const snap = await getDocs(query(collection(await db(), 'users', currentUser.uid, 'projects'), orderBy('updatedAt', 'desc'), limit(100)));
  return snap.docs.map((d) => ({ id: d.id, name: String(d.get('name') ?? 'Untitled'), updatedAt: Number(d.get('updatedAt') ?? 0) }));
}

export async function loadCloudProject(id: string): Promise<Project | null> {
  if (!currentUser) return null;
  const { doc, getDoc } = await import('firebase/firestore');
  const snap = await getDoc(doc(await db(), 'users', currentUser.uid, 'projects', id));
  if (!snap.exists()) return null;
  return JSON.parse(String(snap.get('data'))) as Project;
}

export async function deleteCloudProject(id: string) {
  if (!currentUser) return;
  const { doc, deleteDoc } = await import('firebase/firestore');
  await deleteDoc(doc(await db(), 'users', currentUser.uid, 'projects', id));
}

export interface CloudProjectChange {
  type: 'added' | 'modified' | 'removed';
  info: CloudProjectInfo;
  /** True when this device wrote the change and Firestore has not confirmed it yet. */
  local: boolean;
  load: () => Project | null;
}

// Live index of the signed-in user's cloud projects, kept by watchCloudProjects.
let cloudIndex: Map<string, CloudProjectInfo> | null = null;

/** Last updatedAt the cloud has for a project, or undefined if unknown. */
export function cloudUpdatedAt(id: string): number | undefined {
  return cloudIndex?.get(id)?.updatedAt;
}

/**
 * Listen to the user's projects collection. The first callback carries every project
 * (initial = true) so callers can reconcile; later ones carry what other devices changed.
 */
export async function watchCloudProjects(onChange: (changes: CloudProjectChange[], initial: boolean) => void): Promise<() => void> {
  if (!currentUser) return () => {};
  const { collection, onSnapshot } = await import('firebase/firestore');
  const index = new Map<string, CloudProjectInfo>();
  let initial = true;
  const unsubscribe = onSnapshot(collection(await db(), 'users', currentUser.uid, 'projects'), { includeMetadataChanges: true }, (snap) => {
    // Reconciling against an offline cache could mistake missing projects for deleted ones.
    if (initial && snap.metadata.fromCache) return;
    const docChanges = initial ? snap.docs.map((doc) => ({ type: 'added' as const, doc })) : snap.docChanges();
    const changes: CloudProjectChange[] = docChanges.map((c) => {
      const d = c.doc;
      const info = { id: d.id, name: String(d.get('name') ?? 'Untitled'), updatedAt: Number(d.get('updatedAt') ?? 0) };
      if (c.type === 'removed') index.delete(d.id);
      else index.set(d.id, info);
      return {
        type: c.type, info, local: d.metadata.hasPendingWrites,
        load: () => { try { return JSON.parse(String(d.get('data'))) as Project; } catch { return null; } },
      };
    });
    cloudIndex = index;
    const first = initial;
    initial = false;
    if (first || changes.length) onChange(changes, first);
  }, (e) => {
    console.warn('Cloud project sync unavailable', e);
    useAuth.setState({ lastSyncError: e.message });
  });
  return () => {
    unsubscribe();
    if (cloudIndex === index) cloudIndex = null;
  };
}

// ---------------------------------------------------------------- samples

const sampleErrors = new Map<string, string>();
const uploads = new Map<string, Promise<string>>();
function sampleError(id: string, error: unknown) {
  sampleErrors.set(id, `Audio sync failed: ${(error as Error).message ?? String(error)}`);
  useAuth.setState({ sampleSyncError: sampleErrors.values().next().value ?? null });
}
function sampleSynced(id: string) {
  sampleErrors.delete(id);
  useAuth.setState({ sampleSyncError: sampleErrors.values().next().value ?? null });
}

export async function syncProjectSamples(p: Project, localOnly = false, ownerUid?: string) {
  if (ownerUid && currentUser?.uid !== ownerUid) throw new Error('Account changed while syncing audio');
  const ids = p.tracks.flatMap((t) => [
    ...t.clips.flatMap((c) => c.type === 'audio' ? [c.sampleId] : []),
    ...(t.drumLanes?.map((l) => l.sampleId) ?? []),
  ]);
  if (ownerUid) await syncSamples(ids, localOnly, ownerUid);
  else await syncSamples(ids, localOnly);
  if (ownerUid && currentUser?.uid !== ownerUid) throw new Error('Account changed while syncing audio');
}

async function uploadSample(meta: SampleMeta, data: ArrayBuffer, mime: string): Promise<string | null> {
  if (!currentUser) return null;
  const uid = currentUser.uid;
  const key = `${uid}/${meta.id}`;
  const existing = uploads.get(key);
  if (existing) return existing;
  const upload = (async () => {
    try {
      const app = await getFirebaseApp();
      const { getStorage, ref, uploadBytes } = await import('firebase/storage');
      const { doc, setDoc } = await import('firebase/firestore');
      const path = `users/${uid}/samples/${meta.id}`;
      await uploadBytes(ref(getStorage(app!), path), new Uint8Array(data), { contentType: mime });
      await setDoc(doc(await db(), 'users', uid, 'samples', meta.id), { ...stripUndefined(meta), storagePath: path });
      if (currentUser?.uid === uid) sampleSynced(meta.id);
      return path;
    } catch (e) {
      if (currentUser?.uid === uid) sampleError(meta.id, e);
      throw e;
    } finally {
      uploads.delete(key);
      useAuth.setState({ syncingAudio: uploads.size > 0 });
    }
  })();
  uploads.set(key, upload);
  useAuth.setState({ syncingAudio: true });
  return upload;
}

async function fetchSampleBytes(meta: SampleMeta | undefined, id: string): Promise<ArrayBuffer | null> {
  if (!currentUser) return null;
  const uid = currentUser.uid;
  const app = await getFirebaseApp();
  const { getStorage, ref, getBytes } = await import('firebase/storage');
  const path = meta?.storagePath?.startsWith(`users/${uid}/samples/`) ? meta.storagePath : `users/${uid}/samples/${id}`;
  try {
    const data = await getBytes(ref(getStorage(app!), path));
    if (currentUser?.uid === uid) sampleSynced(id);
    return data;
  } catch (e) {
    if (currentUser?.uid === uid) sampleError(id, e);
    return null;
  }
}

/** Follow sample metadata too: a PC may finish uploading after the laptop signs in. */
async function watchSampleIndex(uid: string): Promise<() => void> {
  const { collection, onSnapshot } = await import('firebase/firestore');
  return onSnapshot(collection(await db(), 'users', uid, 'samples'), (snap) => {
    if (currentUser?.uid !== uid) return;
    mergeRemoteSamples(snap.docs.map((d) => d.data() as SampleMeta));
    sampleSynced('index');
  }, (e) => { if (currentUser?.uid === uid) sampleError('index', e); });
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}
