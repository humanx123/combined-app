import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SampleMeta } from '../model/types';

const mocks = vi.hoisted(() => ({ data: new Map<string, unknown>(), decoded: { duration: 1 }, decode: vi.fn() }));
vi.mock('idb-keyval', () => ({
  get: vi.fn(async (key: string) => mocks.data.get(key)),
  set: vi.fn(async (key: string, value: unknown) => { mocks.data.set(key, value); }),
  del: vi.fn(),
}));
let lib: typeof import('./library');
const meta = (id = 's-local'): SampleMeta => ({ id, name: 'Uploaded guitar', source: 'user', category: 'guitar', kind: 'loop', duration: 1, tags: [], createdAt: 1 });
const audio = () => ({ data: new ArrayBuffer(8), mime: 'audio/wav' });

beforeEach(async () => {
  vi.resetModules();
  mocks.data.clear();
  mocks.decode.mockReset().mockResolvedValue(mocks.decoded);
  vi.stubGlobal('OfflineAudioContext', class { decodeAudioData = mocks.decode; });
  lib = await import('./library');
});
afterEach(() => vi.unstubAllGlobals());

describe('sample transfer between devices', () => {
  it('moves a PC-only sample to a fresh laptop before its metadata index arrives', async () => {
    const uploaded = new Map<string, ArrayBuffer>();
    lib.useLibrary.getState().upsert(meta());
    mocks.data.set('vibe:sample:s-local', audio());
    lib.setRemoteSampleUploader(async (m, bytes) => {
      uploaded.set(m.id, bytes);
      return `users/a/samples/${m.id}`;
    });
    await lib.syncSamples(['s-local'], true);
    const cloudMeta = lib.getSampleMeta('s-local')!;
    // New device: no IndexedDB data, decoded buffers, or library index.
    mocks.data.clear();
    vi.resetModules();
    const laptop = await import('./library');
    laptop.setRemoteSampleFetcher(async (_meta, id) => uploaded.get(id) ?? null);
    expect(laptop.getSampleMeta('s-local')).toBeUndefined();
    expect(await laptop.loadBuffer('s-local')).toBe(mocks.decoded);
    laptop.mergeRemoteSamples([cloudMeta]);
    expect(laptop.getSampleMeta('s-local')?.storagePath).toBe('users/a/samples/s-local');
    expect(mocks.data.has('vibe:sample:s-local')).toBe(true);
  });

  it('downloads by sample id even when cloud metadata has not arrived', async () => {
    const bytes = new ArrayBuffer(8);
    const fetcher = vi.fn(async () => bytes);
    lib.setRemoteSampleFetcher(fetcher);
    const revision = lib.getAudioRevision();
    expect(await lib.loadBuffer('s-remote')).toBe(mocks.decoded);
    expect(fetcher).toHaveBeenCalledWith(undefined, 's-remote');
    expect(mocks.data.get('vibe:sample:s-remote')).toEqual({ data: bytes, mime: 'audio/wav' });
    expect(lib.getAudioRevision()).toBeGreaterThan(revision);
  });

  it('retries a file that was not yet uploaded when the laptop first opened the song', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(new ArrayBuffer(8));
    lib.setRemoteSampleFetcher(fetcher);
    expect(await lib.loadBuffer('s-remote')).toBeNull();
    expect(await lib.loadBuffer('s-remote')).toBe(mocks.decoded);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('persists late cloud metadata and updates an existing sample with its storage path', async () => {
    lib.useLibrary.getState().upsert(meta());
    const remote = { ...meta(), storagePath: 'users/a/samples/s-local' };
    lib.mergeRemoteSamples([remote]);
    await vi.waitFor(() => expect(mocks.data.get('vibe:samples:index')).toEqual([remote]));
    expect(lib.getSampleMeta('s-local')?.storagePath).toBe(remote.storagePath);
  });

  it('publishes a cloud snapshot once and preserves existing fields across repeated IDs', async () => {
    lib.useLibrary.getState().upsert({ ...meta(), storagePath: 'users/a/samples/s-local' });
    const changed = vi.fn();
    const unsubscribe = lib.useLibrary.subscribe(changed);
    lib.mergeRemoteSamples([{ ...meta(), name: 'Renamed' }, meta('s-new'), { ...meta('s-new'), name: 'Latest' }]);
    unsubscribe();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(lib.getSampleMeta('s-local')).toMatchObject({ name: 'Renamed', storagePath: 'users/a/samples/s-local' });
    expect(lib.getSampleMeta('s-new')?.name).toBe('Latest');
    await vi.waitFor(() => expect(mocks.data.get('vibe:samples:index')).toHaveLength(2));
  });

  it('backfills referenced local audio and skips already uploaded files on later saves', async () => {
    lib.useLibrary.getState().upsert(meta());
    const bytes = audio();
    mocks.data.set('vibe:sample:s-local', bytes);
    const upload = vi.fn(async () => 'users/a/samples/s-local');
    lib.setRemoteSampleUploader(upload);
    await lib.syncSamples(['s-local', 's-local']);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(meta(), bytes.data, bytes.mime);
    await lib.syncSamples(['s-local']);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('does not mark a denied upload synced and retries on the next save', async () => {
    lib.useLibrary.getState().upsert(meta());
    mocks.data.set('vibe:sample:s-local', audio());
    const upload = vi.fn().mockRejectedValueOnce(new Error('storage/unauthorized')).mockResolvedValueOnce('users/a/samples/s-local');
    lib.setRemoteSampleUploader(upload);
    await expect(lib.syncSamples(['s-local'])).rejects.toThrow('storage/unauthorized');
    expect(lib.getSampleMeta('s-local')?.storagePath).toBeUndefined();
    await lib.syncSamples(['s-local']);
    expect(lib.getSampleMeta('s-local')?.storagePath).toBe('users/a/samples/s-local');
  });

  it('only backfills local files referenced by the account project', async () => {
    lib.useLibrary.getState().upsert(meta());
    lib.useLibrary.getState().upsert(meta('s-unrelated'));
    mocks.data.set('vibe:sample:s-unrelated', audio());
    const upload = vi.fn();
    lib.setRemoteSampleUploader(upload);
    await lib.syncSamples(['s-local', 's-no-metadata', 'b-kick-punchy'], true);
    expect(upload).not.toHaveBeenCalled();
    await expect(lib.syncSamples(['s-local'])).rejects.toThrow('original computer');
  });
});


it('uploads an explicitly reused sound into the current account even if another account owns its previous cloud path', async () => {
  lib.useLibrary.getState().upsert({ ...meta(), storagePath: 'users/alice/samples/s-local' });
  mocks.data.set('vibe:sample:s-local', audio());
  const upload = vi.fn(async () => 'users/bob/samples/s-local'); lib.setRemoteSampleUploader(upload);
  await lib.syncSamples(['s-local'], false, 'bob');
  expect(upload).toHaveBeenCalledTimes(1);
  expect(lib.getSampleMeta('s-local')?.storagePath).toBe('users/bob/samples/s-local');
  await lib.syncSamples(['s-local'], false, 'bob'); expect(upload).toHaveBeenCalledTimes(1);
});
