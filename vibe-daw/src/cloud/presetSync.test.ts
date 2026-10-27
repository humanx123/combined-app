import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../model/project';
const mocks = vi.hoisted(() => ({
  user: { uid: 'alice' } as { uid: string } | null,
  authListeners: [] as Array<(next: { user: { uid: string } | null }, prev: { user: { uid: string } | null }) => void>,
  snapshots: new Map<string, (snap: unknown) => void>(), local: new Map<string, unknown>(), remote: new Map<string, unknown>(),
  audio: vi.fn(), tx: vi.fn(), events: [] as string[],
}));
vi.mock('idb-keyval', () => ({
  get: async (key: string) => structuredClone(mocks.local.get(key)),
  set: async (key: string, value: unknown) => { mocks.local.set(key, structuredClone(value)); },
}));
vi.mock('./cloud', () => ({
  useAuth: { getState: () => ({ user: mocks.user }), subscribe: (fn: typeof mocks.authListeners[number]) => { mocks.authListeners.push(fn); } },
  syncProjectSamples: mocks.audio,
}));
vi.mock('./firebase', () => ({ getFirebaseApp: async () => ({}) }));
vi.mock('firebase/firestore', () => ({
  getFirestore: () => ({}),
  collection: (_db: unknown, ...parts: string[]) => parts.join('/'), doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  onSnapshot: (path: string, _opts: unknown, callback: (snap: unknown) => void) => { mocks.snapshots.set(path, callback); return () => mocks.snapshots.delete(path); },
  runTransaction: mocks.tx,
}));
let library: typeof import('../state/presetLibrary');
let sync: typeof import('./presetSync');
function changeUser(user: { uid: string } | null) {
  const prev = { user: mocks.user }; mocks.user = user;
  mocks.authListeners.forEach((fn) => fn({ user }, prev));
}
function snapshot(uid: string, fromCache = false) {
  mocks.snapshots.get(`users/${uid}/library`)?.({ metadata: { fromCache, hasPendingWrites: false }, docs: [] });
}
async function connected(uid = 'alice') {
  await vi.waitFor(() => expect(mocks.snapshots.has(`users/${uid}/library`)).toBe(true));
}
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); mocks.user = { uid: 'alice' }; mocks.authListeners.length = 0; mocks.snapshots.clear(); mocks.local.clear(); mocks.remote.clear(); mocks.events.length = 0;
  mocks.audio.mockReset().mockImplementation(async () => { mocks.events.push('audio'); });
  mocks.tx.mockReset().mockImplementation(async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => fn({
    get: async (path: string) => ({ exists: () => mocks.remote.has(path), data: () => mocks.remote.get(path) }),
    set: (path: string, value: unknown) => { mocks.events.push('record'); mocks.remote.set(path, structuredClone(value)); },
  }));
  library = await import('../state/presetLibrary'); await library.switchPresetAccount('alice');
  sync = await import('./presetSync'); sync.startPresetSync(); await connected();
});
afterEach(async () => { changeUser(null); await vi.advanceTimersByTimeAsync(0); vi.useRealTimers(); });
const save = () => library.savePreset('Cloud keys', 'sound', { project: createProject(), samples: [] });

describe('account library transport', () => {
  it('waits for a server snapshot, uploads audio first, then acknowledges the record', async () => {
    const record = await save(); snapshot('alice', true); await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.tx).not.toHaveBeenCalled();
    snapshot('alice'); await vi.advanceTimersByTimeAsync(500);
    expect(mocks.events).toEqual(['audio', 'record']);
    expect(mocks.audio).toHaveBeenCalledWith(expect.anything(), false, 'alice');
    expect(mocks.remote.has(`users/alice/library/${record.id}`)).toBe(true);
    expect(library.usePresets.getState().dirty).toEqual([]);
  });
  it('retains failed uploads locally, exposes the error and retries without a new save', async () => {
    mocks.audio.mockRejectedValueOnce(new Error('storage/unauthorized'));
    const record = await save(); snapshot('alice'); await vi.advanceTimersByTimeAsync(500);
    expect(mocks.tx).not.toHaveBeenCalled(); expect(library.usePresets.getState().dirty).toContain(record.id);
    expect(library.usePresets.getState().error).toContain('storage/unauthorized');
    sync.retryPresetSync(); await connected(); snapshot('alice'); await vi.advanceTimersByTimeAsync(500);
    expect(library.usePresets.getState().dirty).toEqual([]); expect(library.usePresets.getState().error).toBeNull();
  });
  it('cannot publish an old account record after an audio upload finishes late', async () => {
    let finish!: () => void;
    mocks.audio.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await save(); snapshot('alice'); await vi.advanceTimersByTimeAsync(500);
    changeUser({ uid: 'bob' }); await connected('bob');
    finish(); await vi.advanceTimersByTimeAsync(0);
    expect(mocks.tx).not.toHaveBeenCalled(); expect(library.usePresets.getState().scope).toBe('user:bob');
    expect(library.usePresets.getState().records).toEqual({});
  });
  it('honors a remote deletion even when an offline edit has a later device timestamp', async () => {
    const record = await save();
    mocks.remote.set(`users/alice/library/${record.id}`, { ...record, updatedAt: 1, revision: 'deleted', deleted: true, data: '' });
    snapshot('alice'); await vi.advanceTimersByTimeAsync(500);
    expect(library.usePresets.getState().records[record.id].deleted).toBe(true);
    expect(library.usePresets.getState().dirty).toEqual([]);
    expect(mocks.events).toEqual(['audio']);
  });
});
