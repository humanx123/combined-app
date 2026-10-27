import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMidiClip, createProject, createTrack } from '../model/project';

const mocks = vi.hoisted(() => ({
  sync: vi.fn(), preload: vi.fn(), configure: vi.fn(), schedule: vi.fn(), panic: vi.fn(),
  transport: { state: 'stopped', ticks: 0, PPQ: 192, getTicksAtTime: vi.fn(), pause: vi.fn(), stop: vi.fn(), start: vi.fn() },
}));
vi.mock('tone', () => ({
  Context: class { sampleRate = 48000; state = 'running'; immediate() { return 10; } resume() {} },
  setContext: vi.fn(), getContext: () => ({ sampleRate: 48000 }), getTransport: () => mocks.transport,
}));
vi.mock('./graph', () => ({
  preloadProject: mocks.preload,
  EngineGraph: class { sync = mocks.sync; panic = mocks.panic; setMetronome() {} },
}));
vi.mock('./freeze', () => ({ configureFreeze: mocks.configure, scheduleFreeze: mocks.schedule }));
vi.mock('./samplePreview', () => ({ renderSamplePreview: vi.fn() }));
vi.mock('./unlock', () => ({ nativeAudioContext: () => ({}), resumeAudioContext: vi.fn() }));
vi.mock('../state/settings', () => ({ useSettings: { getState: () => ({ latency: 'playback' }) } }));

let engine: typeof import('./engine');
let store: typeof import('../state/store');
let onFrozen: () => void;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  mocks.preload.mockReset().mockResolvedValue(new Map());
  mocks.sync.mockReset().mockResolvedValue(undefined);
  mocks.transport.state = 'stopped';
  mocks.transport.ticks = 0;
  mocks.transport.getTicksAtTime.mockReturnValue(192 * 6);
  mocks.transport.pause.mockImplementation(() => { mocks.transport.state = 'paused'; });
  mocks.transport.stop.mockImplementation(() => { mocks.transport.state = 'stopped'; });
  mocks.transport.start.mockImplementation(() => { mocks.transport.state = 'started'; });
  store = await import('../state/store');
  const p = createProject();
  const t = createTrack(p, 'instrument', { preset: 'sub_bass' });
  t.clips.push(createMidiClip(p, 0, 16));
  p.tracks.push(t);
  store.useDaw.getState().replaceProject(p);
  engine = await import('./engine');
  engine.initEngine();
  onFrozen = mocks.configure.mock.calls[0][1];
  await engine.engineSettled();
  await engine.play(6);
  // Tone's ticks getter normally includes its look-ahead. Ensure the hold uses
  // ticks at the actual audio time instead, or every update would jump forward.
  mocks.transport.ticks = 192 * 6.25;
  vi.clearAllMocks();
});

afterEach(() => { engine.stop(); vi.unstubAllGlobals(); });

describe('playback during edits', () => {
  it('reuses an in-flight asset load when Play is pressed', async () => {
    engine.pause();
    const loading = deferred();
    mocks.preload.mockReturnValueOnce(loading.promise.then(() => new Map()));
    store.useDaw.getState().update('Change instrument', (p) => { p.tracks[0].instrument!.preset = 'organ'; });
    await vi.waitFor(() => expect(mocks.preload).toHaveBeenCalledTimes(1));
    const playing = engine.play(0);
    expect(store.useTransport.getState().starting).toBe(true);
    loading.resolve();
    await playing;
    expect(mocks.preload).toHaveBeenCalledTimes(1);
    expect(mocks.transport.start).toHaveBeenCalledTimes(1);
    expect(store.useTransport.getState().starting).toBe(false);
  });

  it('pauses before changing scheduled notes and resumes from the audible beat', async () => {
    const applying = deferred();
    mocks.sync.mockReturnValueOnce(applying.promise);
    store.useDaw.getState().update('Agent: notes', (p) => { p.tracks[0].clips[0].length = 8; });
    await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
    expect(mocks.transport.pause).toHaveBeenCalledWith(10);
    expect(mocks.transport.pause.mock.invocationCallOrder[0]).toBeLessThan(mocks.sync.mock.invocationCallOrder[0]);
    expect(store.useTransport.getState().position).toBe(6);
    expect(mocks.transport.start).not.toHaveBeenCalled();
    applying.resolve();
    await engine.engineSettled();
    expect(mocks.transport.ticks).toBe(192 * 6);
    expect(mocks.transport.start).toHaveBeenCalledTimes(1);
    expect(store.useTransport.getState().playing).toBe(true);
  });

  it('keeps playback running while assets load and applies only the newest queued edit', async () => {
    const loading = deferred();
    mocks.preload.mockReturnValueOnce(loading.promise.then(() => new Map()));
    store.useDaw.getState().update('Agent: notes', (p) => { p.tracks[0].clips[0].length = 8; });
    await vi.waitFor(() => expect(mocks.preload).toHaveBeenCalledTimes(1));
    expect(mocks.transport.pause).not.toHaveBeenCalled();
    store.useDaw.getState().update('Agent: latest notes', (p) => { p.tracks[0].clips[0].length = 4; });
    loading.resolve();
    await engine.engineSettled();
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.sync.mock.calls[0][0].tracks[0].clips[0].length).toBe(4);
    expect(mocks.transport.pause).toHaveBeenCalledTimes(1);
    expect(mocks.transport.start).toHaveBeenCalledTimes(1);
  });

  it('keeps fader, pan, and mute updates live without pausing', async () => {
    store.useDaw.getState().update('Mixer', (p) => { p.tracks[0].volumeDb = -12; p.tracks[0].pan = 0.5; p.tracks[0].mute = true; });
    await engine.engineSettled();
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.transport.pause).not.toHaveBeenCalled();
    expect(mocks.transport.start).not.toHaveBeenCalled();
  });

  it.each(['stop', 'pause'] as const)('honors a user %s during an async update', async (action) => {
    const applying = deferred();
    mocks.sync.mockReturnValueOnce(applying.promise);
    store.useDaw.getState().update('Agent: tempo', (p) => { p.bpm = 100; });
    await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
    engine[action]();
    applying.resolve();
    await engine.engineSettled();
    expect(mocks.transport.start).not.toHaveBeenCalled();
    expect(store.useTransport.getState().playing).toBe(false);
  });

  it('honors a seek during the temporary hold', async () => {
    const applying = deferred();
    mocks.sync.mockReturnValueOnce(applying.promise);
    store.useDaw.getState().update('Agent: tempo', (p) => { p.bpm = 100; });
    await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledTimes(1));
    engine.seek(12);
    applying.resolve();
    await vi.waitFor(() => expect(mocks.transport.start).toHaveBeenCalledTimes(1));
    expect(mocks.transport.ticks).toBe(192 * 12);
  });

  it('defers installing completed freezes until the next playback', async () => {
    onFrozen();
    await engine.engineSettled();
    expect(mocks.sync).not.toHaveBeenCalled();
    engine.pause();
    await engine.play(6);
    expect(mocks.sync).toHaveBeenCalledTimes(1);
    expect(mocks.transport.state).toBe('started');
  });

  it('stays paused if applying the new graph fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.sync.mockRejectedValueOnce(new Error('Graph failed'));
    store.useDaw.getState().update('Agent: tempo', (p) => { p.bpm = 100; });
    await expect(engine.engineSettled()).rejects.toThrow('Graph failed');
    expect(mocks.transport.start).not.toHaveBeenCalled();
    expect(store.useTransport.getState().playing).toBe(false);
    log.mockRestore();
  });
});
