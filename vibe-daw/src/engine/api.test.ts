import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  unlock: vi.fn(), init: vi.fn(), play: vi.fn(), toggle: vi.fn(), stop: vi.fn(), run: vi.fn(),
}));
vi.mock('./unlock', () => ({ unlockAudio: mocks.unlock, unlockAudioOnGestures: vi.fn() }));
vi.mock('./engine', () => ({ initEngine: mocks.init, play: mocks.play, togglePlay: mocks.toggle, stop: mocks.stop }));
vi.mock('./lock', () => ({ contextLock: { run: mocks.run } }));

let api: typeof import('./api');
let transport: typeof import('../state/store').useTransport;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.run.mockImplementation((fn) => Promise.resolve().then(fn));
  mocks.init.mockReset();
  mocks.play.mockReset().mockResolvedValue(undefined);
  api = await import('./api');
  transport = (await import('../state/store')).useTransport;
});

describe('playback requests', () => {
  it('unlocks audio and shows startup before waiting for the lazy engine', async () => {
    const done = api.play(4);
    expect(mocks.unlock).toHaveBeenCalledTimes(1);
    expect(mocks.init).not.toHaveBeenCalled();
    expect(transport.getState().starting).toBe(true);
    await done;
    expect(mocks.play).toHaveBeenCalledWith(4);
    expect(transport.getState().starting).toBe(false);
  });

  it('cancels a pending engine load without starting audio later', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    mocks.run.mockImplementation(async (fn) => { await held; return fn(); });
    const done = api.play();
    await api.togglePlay();
    expect(transport.getState().starting).toBe(false);
    release();
    await done;
    expect(mocks.play).not.toHaveBeenCalled();
  });

  it('allows another click to retry a failed engine initialization', async () => {
    mocks.init.mockImplementationOnce(() => { throw new Error('Load failed'); });
    await expect(api.play()).rejects.toThrow('Load failed');
    expect(transport.getState().starting).toBe(false);
    await api.play();
    expect(mocks.play).toHaveBeenCalledTimes(1);
  });

  it('clears startup after a playback failure so the next click retries', async () => {
    mocks.play.mockRejectedValueOnce(new Error('Audio blocked'));
    await expect(api.togglePlay()).rejects.toThrow('Audio blocked');
    expect(transport.getState().starting).toBe(false);
    await api.togglePlay();
    expect(mocks.play).toHaveBeenCalledTimes(2);
  });
});
