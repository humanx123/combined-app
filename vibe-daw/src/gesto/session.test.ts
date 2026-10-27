import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const api = vi.hoisted(() => ({ liveChord: vi.fn(), liveNote: vi.fn(), liveRelease: vi.fn(), play: vi.fn(async () => {}), currentBeat: vi.fn(() => 0) }));
vi.mock('../engine/api', () => api);

import { useDaw, useTransport } from '../state/store';
import { createProject } from '../model/project';
import type { MidiClip } from '../model/types';
import { startKeyboard, startRecording, stopRecording, stopInput, useGesto } from './session';

const key = (k: string, down = true) => env.listeners.get(down ? 'keydown' : 'keyup')!({ key: k, repeat: false, target: {}, preventDefault() {}, stopPropagation() {} });

beforeEach(() => {
  stopInput();
  useDaw.getState().replaceProject({ ...createProject(), key: { root: 'C', scale: 'major' } });
  useGesto.setState({ trackId: null, settings: { ...useGesto.getState().settings, keyOffset: 0, harmony: 'diatonicMajor', style: 'fingers', octave: 0, bass: false, arp: 0, quantize: 1 } });
  useTransport.setState({ playing: false, recording: false, position: 0 });
  Object.values(api).forEach((f) => f.mockClear());
  api.currentBeat.mockImplementation(() => env.beat);
  env.beat = 0;
});

describe('Gesto session', () => {
  it('creates a Gesto pad track and plays held keys on its monitor', () => {
    startKeyboard();
    const track = useDaw.getState().project.tracks.find((t) => t.name === 'Gesto')!;
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

  it('records a live take into a quantized, bar-aligned clip', async () => {
    startKeyboard();
    env.beat = 0.1;
    await startRecording();
    expect(api.play).toHaveBeenCalled();
    useTransport.setState({ playing: true });
    key('1'); env.step();
    env.beat = 3.9; key('1', false); key('5'); env.step();
    env.beat = 6.2; key('5', false); env.step();
    env.beat = 8;
    const clipId = stopRecording()!;
    const p = useDaw.getState().project;
    const track = p.tracks.find((t) => t.clips.some((c) => c.id === clipId))!;
    const clip = track.clips.find((c) => c.id === clipId) as MidiClip;
    expect(track.name).toBe('Gesto');
    expect(clip).toMatchObject({ start: 0, length: 8, name: 'Gesto · C G' });
    expect(clip.notes.filter((n) => n.start === 0).map((n) => n.pitch)).toEqual([48, 52, 55]);
    expect(clip.notes.filter((n) => n.start === 4).every((n) => n.duration === 2 && [55, 59, 62].includes(n.pitch))).toBe(true);
    expect(useDaw.getState().selection.clipIds).toEqual([clipId]);
    expect(useTransport.getState().recording).toBe(false);
  });

  it('puts an overlapping take on a new Gesto track with the same sound', async () => {
    startKeyboard();
    for (let i = 0; i < 2; i++) {
      env.beat = 0;
      await startRecording();
      key('1'); env.step();
      env.beat = 4; key('1', false); env.step();
      stopRecording();
    }
    const gesto = useDaw.getState().project.tracks.filter((t) => t.name.startsWith('Gesto'));
    expect(gesto.map((t) => t.name)).toEqual(['Gesto', 'Gesto 2']);
    expect(gesto[1].instrument?.preset).toBe('pad');
  });

  it('ends the take when the song stops', async () => {
    startKeyboard();
    await startRecording();
    useTransport.setState({ playing: true });
    key('4'); env.step();
    env.beat = 4;
    env.step();
    useTransport.setState({ playing: false });
    expect(useGesto.getState().recording).toBe(false);
    const clips = useDaw.getState().project.tracks.flatMap((t) => t.clips);
    expect(clips).toHaveLength(1);
    expect(clips[0].name).toBe('Gesto · F');
  });
});
