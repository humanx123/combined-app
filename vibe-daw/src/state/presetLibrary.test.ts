import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../model/project';
const mocks = vi.hoisted(() => ({ data: new Map<string, unknown>(), get: vi.fn(), set: vi.fn() }));
vi.mock('idb-keyval', () => ({ get: mocks.get, set: mocks.set }));
let lib: typeof import('./presetLibrary');
beforeEach(async () => {
  vi.resetModules(); mocks.data.clear();
  mocks.get.mockReset().mockImplementation(async (key: string) => structuredClone(mocks.data.get(key)));
  mocks.set.mockReset().mockImplementation(async (key: string, value: unknown) => { mocks.data.set(key, structuredClone(value)); });
  lib = await import('./presetLibrary'); await lib.switchPresetAccount(null);
});
const payload = () => ({ project: createProject('Snapshot'), samples: [] });

describe('durable account preset libraries', () => {
  it('persists offline saves, tags and pending uploads across reloads', async () => {
    const saved = await lib.savePreset('Warm room', 'effects', payload(), ['warm']);
    await lib.switchPresetAccount(null);
    expect(lib.usePresets.getState().records[saved.id]).toMatchObject({ name: 'Warm room', tags: ['warm'] });
    expect(lib.usePresets.getState().dirty).toEqual([saved.id]);
  });
  it('isolates libraries between accounts and ignores late callbacks from an old account', async () => {
    await lib.switchPresetAccount('alice');
    const saved = await lib.savePreset('Private sound', 'sound', payload());
    await lib.switchPresetAccount('bob');
    await lib.mergeRemotePresets('user:alice', [{ ...saved, name: 'Late callback' }]);
    expect(lib.usePresets.getState().records).toEqual({});
    await lib.switchPresetAccount('alice');
    expect(lib.usePresets.getState().records[saved.id].name).toBe('Private sound');
    await lib.switchPresetAccount(null); expect(lib.usePresets.getState().records).toEqual({});
  });
  it('imports device items only after the explicit copy action and uses fresh IDs', async () => {
    const guest = await lib.savePreset('Device phrase', 'clip', payload());
    await lib.switchPresetAccount('alice'); expect(lib.usePresets.getState().records).toEqual({});
    expect(await lib.copyDevicePresetsToAccount()).toBe(1);
    const items = Object.values(lib.usePresets.getState().records);
    expect(items[0].name).toBe('Device phrase'); expect(items[0].id).not.toBe(guest.id);
  });
  it('acknowledges uploaded revisions and never revives a tombstone from an offline edit', async () => {
    const saved = await lib.savePreset('Old phrase', 'clip', payload());
    await lib.mergeRemotePresets('device', [saved]); expect(lib.usePresets.getState().dirty).toEqual([]);
    const deleted = { ...saved, deleted: true, data: '', updatedAt: saved.updatedAt + 1, revision: 'z' };
    await lib.mergeRemotePresets('device', [deleted]);
    await lib.mergeRemotePresets('device', [{ ...saved, updatedAt: saved.updatedAt + 100_000, name: 'Offline rename' }]);
    expect(lib.usePresets.getState().records[saved.id]).toEqual(deleted);
    await lib.switchPresetAccount(null); expect(lib.usePresets.getState().records[saved.id].deleted).toBe(true);
  });
  it('uses revision IDs to resolve equal-time edits deterministically', async () => {
    const saved = await lib.savePreset('A', 'sound', payload());
    const first = { ...saved, revision: 'a', name: 'First' }, second = { ...saved, revision: 'z', name: 'Second' };
    await lib.mergeRemotePresets('device', [first, second]);
    const expected = [saved, first, second].sort(lib.comparePresets).at(-1)!;
    expect(lib.usePresets.getState().records[saved.id]).toEqual(expected);
  });
  it('rejects oversized, malformed and blank records and reports failed disk writes', async () => {
    await expect(lib.savePreset('', 'clip', payload())).rejects.toThrow('name');
    await expect(lib.savePreset('Big', 'clip', { ...payload(), samples: [], project: { ...createProject(), name: 'x'.repeat(760000) } })).rejects.toThrow('750 KB');
    expect(lib.parsePresetRecord({ id: 'bad/path' })).toBeNull();
    mocks.set.mockRejectedValueOnce(new Error('quota'));
    await expect(lib.savePreset('Retained in memory', 'clip', payload())).rejects.toThrow('quota');
    expect(lib.usePresets.getState().dirty).toHaveLength(1);
    expect(lib.usePresets.getState().error).toContain('quota');
  });
});


it('rejects unsafe attribution URLs before saved samples reach the UI', async () => {
  const data = { ...payload(), samples: [{ id: 'external', name: 'Sound', category: 'fx', kind: 'oneshot', tags: [], duration: 1, source: 'online', createdAt: 1, attribution: { sourceUrl: 'javascript:alert(1)', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', license: 'CC0', author: 'Author' } }] };
  await expect(lib.savePreset('Untrusted source', 'sound', data as any)).rejects.toThrow('attribution');
  expect(lib.usePresets.getState().records).toEqual({});
});
