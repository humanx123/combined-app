import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioClip, createProject, createTrack } from '../model/project';
import type { SampleMeta } from '../model/types';

const mocks = vi.hoisted(() => ({
  authChange: null as null | ((user: { uid: string } | null) => void),
  uploader: null as null | ((meta: SampleMeta, data: ArrayBuffer, mime: string) => Promise<string | null>),
  fetcher: null as null | ((meta: SampleMeta | undefined, id: string) => Promise<ArrayBuffer | null>),
  indexChange: null as null | ((snap: { docs: Array<{ data(): SampleMeta }> }) => void),
  upload: vi.fn(), getBytes: vi.fn(), setDoc: vi.fn(), syncSamples: vi.fn(), merge: vi.fn(),
}));
vi.mock('./firebase', () => ({ getFirebaseApp: async () => ({}) }));
vi.mock('./config', () => ({ firebaseConfigured: true }));
vi.mock('firebase/auth', () => ({ getAuth: () => ({}), onAuthStateChanged: (_a: unknown, fn: typeof mocks.authChange) => { mocks.authChange = fn; fn?.({ uid: 'a' }); } }));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}), doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'), setDoc: mocks.setDoc,
  onSnapshot: (_ref: unknown, fn: typeof mocks.indexChange) => { mocks.indexChange = fn; return vi.fn(); },
}));
vi.mock('firebase/storage', () => ({ getStorage: () => ({}), ref: (_s: unknown, path: string) => path, uploadBytes: mocks.upload, getBytes: mocks.getBytes }));
vi.mock('../samples/library', () => ({
  mergeRemoteSamples: mocks.merge, syncSamples: mocks.syncSamples,
  setRemoteSampleUploader: (fn: typeof mocks.uploader) => { mocks.uploader = fn; },
  setRemoteSampleFetcher: (fn: typeof mocks.fetcher) => { mocks.fetcher = fn; },
}));

let cloud: typeof import('./cloud');
const meta: SampleMeta = { id: 's1', name: 'Guitar', source: 'user', category: 'guitar', kind: 'loop', tags: [], duration: 1, createdAt: 1 };

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.indexChange = null;
  mocks.upload.mockReset().mockResolvedValue(undefined);
  mocks.setDoc.mockReset().mockResolvedValue(undefined);
  mocks.syncSamples.mockReset().mockResolvedValue(undefined);
  mocks.getBytes.mockReset().mockResolvedValue(new ArrayBuffer(8));
  cloud = await import('./cloud');
  await cloud.initCloud();
  await vi.waitFor(() => expect(mocks.indexChange).toBeTypeOf('function'));
});

describe('project and audio cloud sync', () => {
  it('uploads referenced audio before publishing the composition', async () => {
    const p = createProject();
    const t = createTrack(p, 'audio');
    t.clips.push(createAudioClip(p, 's1', 0, 4));
    p.tracks.push(t);
    await cloud.saveProjectToCloud(p);
    expect(mocks.syncSamples).toHaveBeenCalledWith(['s1'], false, 'a');
    expect(mocks.syncSamples.mock.invocationCallOrder[0]).toBeLessThan(mocks.setDoc.mock.invocationCallOrder[0]);
  });

  it('does not report a project synced when its audio transfer fails', async () => {
    mocks.syncSamples.mockRejectedValueOnce(new Error('Audio upload denied'));
    await expect(cloud.saveProjectToCloud(createProject())).rejects.toThrow('Audio upload denied');
    expect(mocks.setDoc).not.toHaveBeenCalled();
    expect(cloud.useAuth.getState().lastSyncError).toBe('Audio upload denied');
  });

  it('downloads audio by its stable path before the index is ready', async () => {
    expect(await mocks.fetcher!(undefined, 's1')).toBeInstanceOf(ArrayBuffer);
    expect(mocks.getBytes).toHaveBeenCalledWith('users/a/samples/s1');
  });

  it('merges live metadata updates, including files uploaded after sign-in', () => {
    mocks.indexChange!({ docs: [{ data: () => meta }] });
    expect(mocks.merge).toHaveBeenCalledWith([meta]);
  });

  it('deduplicates concurrent uploads and exposes permission failures', async () => {
    mocks.upload.mockRejectedValueOnce(new Error('storage/unauthorized'));
    const bytes = new ArrayBuffer(8);
    await Promise.all([
      expect(mocks.uploader!(meta, bytes, 'audio/wav')).rejects.toThrow('storage/unauthorized'),
      expect(mocks.uploader!(meta, bytes, 'audio/wav')).rejects.toThrow('storage/unauthorized'),
    ]);
    expect(mocks.upload).toHaveBeenCalledTimes(1);
    expect(cloud.useAuth.getState().sampleSyncError).toContain('storage/unauthorized');
    await mocks.uploader!(meta, bytes, 'audio/wav');
    expect(cloud.useAuth.getState().sampleSyncError).toBeNull();
  });

  it('ignores sample metadata from an account that has signed out', () => {
    mocks.authChange!(null);
    mocks.indexChange!({ docs: [{ data: () => meta }] });
    expect(mocks.merge).not.toHaveBeenCalled();
  });
});
