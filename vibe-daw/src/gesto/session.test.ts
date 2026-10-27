import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => {
  const cache = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => cache.get(k) ?? null, setItem: (k: string, v: string) => cache.set(k, v), removeItem: (k: string) => cache.delete(k) } });
  const listeners = new Map<string, (e: unknown) => void>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener: (t: string, fn: (e: unknown) => void) => listeners.set(t, fn), removeEventListener: (t: string) => listeners.delete(t), location: { hash: '' } } });
  let frame: FrameRequestCallback | null = null;
  globalThis.requestAnimationFrame = (fn: FrameRequestCallback) => { frame = fn; return 1; };
  globalThis.cancelAnimationFrame = () => { frame = null; };
  // The chord reader debounces degree changes for 100 ms: each frame moves its clock on.
  let now = 0;
  performance.now = () => now;
  return { listeners, beat: 0, step: () => { now += 150; frame?.(0); now += 150; frame?.(0); } };
});

const api = vi.hoisted(() => ({
  liveChord: vi.fn(), liveNote: vi.fn(), liveRelease: vi.fn(), clearLive: vi.fn(),
  scheduleLive: vi.fn((..._args: unknown[]) => true), scheduleLiveRelease: vi.fn(), prepareLive: vi.fn(async () => {}),
  lookAheadSeconds: vi.fn(() => 0.12), currentBeat: vi.fn(() => 0),
  play: vi.fn(async () => {}), stop: vi.fn(),
}));
vi.mock('../engine/api', () => api);

import { useDaw, useTransport } from '../state/store';
import { createProject } from '../model/project';
import type { MidiClip } from '../model/types';
import { startKeyboard, startRecording, stopRecording, stopInput, useGesto } from './session';

const key = (k: string, down = true) => env.listeners.get(down ? 'keydown' : 'keyup')!({ key: k, repeat: false, target: {}, preventDefault() {}, stopPropagation() {} });
const flush = () => new Promise<void>((r) => setTimeout(r, 0));
const project = () => useDaw.getState().project;
const trackNamed = (name: string) => project().tracks.find((t) => t.name === name)!;
const clipsOf = (name: string) => trackNamed(name).clips as MidiClip[];

/** Move the song to `to` in 0.05-beat hops, running the 40 ms ticker and a hand frame each hop. */
async function playTo(to: number) {
  while (env.beat < to - 1e-9) {
    env.beat = Math.min(to, Math.round((env.beat + 0.05) * 100) / 100);
    vi.advanceTimersByTime(40);
    env.step();
  }
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  stopInput();
  useDaw.getState().replaceProject({ ...createProject(), bpm: 120, key: { root: 'C', scale: 'major' } });
  useGesto.setState({
    trackId: null, bassTrackId: null, drumTrackId: null,
    settings: { ...useGesto.getState().settings, keyOffset: 0, harmony: 'diatonicMajor', style: 'fingers', octave: 0, bass: false, arp: 0, quantize: 1, band: false, groove: 'boombap', percussion: false, bassStyle: 'kick', bassPreset: null },
  });
  useTransport.setState({ playing: false, recording: false, position: 0 });
  Object.values(api).forEach((f) => f.mockClear());
  api.currentBeat.mockImplementation(() => env.beat);
  api.play.mockImplementation(async () => { useTransport.setState({ playing: true }); });
  api.stop.mockImplementation(() => { useTransport.setState({ playing: false }); });
  env.beat = 0;
});
afterEach(() => { stopInput(); vi.useRealTimers(); });

describe('Gesto pads', () => {
  it('creates a Gesto pad track and plays held keys on its monitor', () => {
    startKeyboard();
    const track = trackNamed('Gesto');
    expect(track.instrument?.preset).toBe('pad');
    key('1');
    env.step();
    expect(api.liveChord).toHaveBeenLastCalledWith(track.id, [48, 52, 55], 0.74);
    expect(useGesto.getState().chord).toBe('C');
    key('1', false);
    env.step();
    expect(api.liveRelease).toHaveBeenLastCalledWith(track.id);
    expect(useGesto.getState().chord).toBeNull();
  });

  it('grows a muted clip bar by bar while recording, then keeps it as a normal clip', async () => {
    startKeyboard();
    await startRecording();
    expect(api.play).toHaveBeenCalled();
    key('1');
    await playTo(3.9);
    key('1', false); key('5');
    await playTo(4.3);
    const live = clipsOf('Gesto')[0];
    expect(live).toMatchObject({ muted: true, start: 0, length: 8 });
    expect(live.name.startsWith('● Gesto')).toBe(true);
    expect(live.notes.some((n) => n.pitch === 48)).toBe(true);

    await playTo(6.2);
    key('5', false);
    await playTo(8);
    const clipId = stopRecording()!;
    expect(api.stop).toHaveBeenCalled();
    const clip = clipsOf('Gesto').find((c) => c.id === clipId)!;
    expect(clip).toMatchObject({ muted: false, start: 0, length: 8, name: 'Gesto · C G' });
    expect(clip.notes.filter((n) => n.start === 0).map((n) => n.pitch)).toEqual([48, 52, 55]);
    expect(clip.notes.filter((n) => n.start === 4).every((n) => n.duration === 2 && [55, 59, 62].includes(n.pitch))).toBe(true);
    expect(useDaw.getState().selection.clipIds).toEqual([clipId]);
    expect(useTransport.getState().recording).toBe(false);
  });

  it('puts a take that would land on another clip onto a new Gesto track with the same sound', async () => {
    startKeyboard();
    for (let i = 0; i < 2; i++) {
      env.beat = 0;
      await startRecording();
      key('1');
      await playTo(4);
      key('1', false);
      env.step();
      stopRecording();
    }
    const gesto = project().tracks.filter((t) => t.name.startsWith('Gesto'));
    expect(gesto.map((t) => t.name)).toEqual(['Gesto', 'Gesto 2']);
    expect(gesto[1].instrument?.preset).toBe('pad');
  });

  it('ends the take when the song stops', async () => {
    startKeyboard();
    await startRecording();
    key('4');
    await playTo(4);
    useTransport.setState({ playing: false });
    expect(useGesto.getState().recording).toBe(false);
    const clips = project().tracks.flatMap((t) => t.clips);
    expect(clips).toHaveLength(1);
    expect(clips[0]).toMatchObject({ name: 'Gesto · F', muted: false });
  });
});

describe('Gesto live band', () => {
  const calls = (trackId: string) => api.scheduleLive.mock.calls.filter((c) => c[0] === trackId) as unknown as Array<[string, number, number, number, number]>;

  it('plays drums and a bass that follows the chords, and records exactly what it played', async () => {
    useGesto.getState().setSettings({ band: true, groove: 'boombap', bassStyle: 'kick' });
    startKeyboard();
    key('1');
    env.step();
    await startRecording();
    await flush();
    expect(api.prepareLive).toHaveBeenCalled();
    await playTo(4);
    key('1', false); key('5');
    await playTo(8.5);
    stopRecording();

    const drums = trackNamed('Gesto Drums'), bass = trackNamed('Gesto Bass');
    expect(drums.kind).toBe('drums');
    expect(bass.instrument?.preset).toBe('electric_bass');
    // Boom bap: kick on steps 0, 7, 10 and snare on 4, 12 of each bar (beat 0 itself was too close to play on time).
    const hits = calls(drums.id).map(([, beat, note]) => `${beat}:${note}`);
    for (const h of ['1:38', '1.75:36', '2.5:36', '3:38', '4:36', '5:38', '5.75:36']) expect(hits).toContain(h);
    // The bass plays the kick's rhythm on C, then on G once the chord changes.
    const bassNotes = calls(bass.id).map(([, beat, pitch]) => [beat, pitch]);
    expect(bassNotes).toContainEqual([1.75, 36]);
    expect(bassNotes).toContainEqual([2.5, 36]);
    expect(bassNotes.filter(([b]) => b >= 4.5).every(([, p]) => p === 43)).toBe(true);

    // The recorded clips hold exactly the scheduled notes inside the take.
    const drumClip = clipsOf('Gesto Drums')[0];
    const bassClip = clipsOf('Gesto Bass')[0];
    expect(drumClip).toMatchObject({ muted: false, start: 0, name: 'Drums · Boom bap' });
    expect(bassClip.name).toBe('Bass · C G');
    const recordedHits = drumClip.notes.map((n) => `${n.start + drumClip.start}:${n.pitch}`).sort();
    const scheduledInTake = calls(drums.id).filter(([, beat]) => beat < 8.5).map(([, beat, note]) => `${beat}:${note}`).sort();
    expect(recordedHits).toEqual(scheduledInTake);
    expect(bassClip.notes.map((n) => [n.start, n.pitch])).toEqual(calls(bass.id).filter(([, b]) => b < 8.5).map(([, b, p]) => [b, p]));
  });

  it('cuts a ringing bass note on a chord change and plays the new root at once', async () => {
    useGesto.getState().setSettings({ band: true, groove: 'house', bassStyle: 'roots' });
    startKeyboard();
    key('1'); env.step();
    await startRecording();
    await flush();
    await playTo(2.2);
    key('1', false); key('6'); // vi: A minor
    await playTo(3.5);
    stopRecording();
    const bass = trackNamed('Gesto Bass');
    const releases = api.scheduleLiveRelease.mock.calls.filter((c) => c[0] === bass.id).map((c) => c[1] as number);
    // The change lands within half a beat (the engine's look-ahead plus one tick).
    const cut = releases.find((b) => b > 2.2)!;
    expect(cut).toBeLessThanOrEqual(2.75);
    expect(calls(bass.id)).toContainEqual([bass.id, cut, 45, expect.any(Number), 0.85]);
    // In the clip, the C note ends where the A starts.
    const notes = clipsOf('Gesto Bass')[0].notes;
    const c = notes.find((n) => n.pitch === 36)!;
    expect(c.start + c.duration).toBeCloseTo(cut);
  });

  it('undoes a whole take, band tracks included, in one step', async () => {
    useGesto.getState().setSettings({ band: true });
    startKeyboard();
    const before = project().tracks.map((t) => t.name);
    key('2'); env.step();
    await startRecording();
    await flush();
    await playTo(5);
    stopRecording();
    expect(project().tracks.map((t) => t.name)).toEqual([...before, 'Gesto Drums', 'Gesto Bass']);
    useDaw.getState().undo();
    expect(project().tracks.map((t) => t.name)).toEqual(before);
  });

  it('stays silent until the song plays and stops placing notes when it stops', async () => {
    useGesto.getState().setSettings({ band: true });
    startKeyboard();
    key('1'); env.step();
    vi.advanceTimersByTime(400);
    expect(api.scheduleLive).not.toHaveBeenCalled();
    await api.play();
    await flush();
    await playTo(2);
    const placed = api.scheduleLive.mock.calls.length;
    expect(placed).toBeGreaterThan(0);
    api.stop();
    await flush();
    expect(api.clearLive).toHaveBeenCalled();
    await playTo(3);
    expect(api.scheduleLive.mock.calls.length).toBe(placed);
  });
});
