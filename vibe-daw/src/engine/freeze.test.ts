import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMidiClip, createProject, createTrack } from '../model/project';
import type { Project } from '../model/types';
import type { RenderOptions } from './render';
import type { PcmData } from './wav';

const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('./render', () => ({ renderProject: render }));

let freeze: typeof import('./freeze');
let jobs: Array<{ project: Project; opts: RenderOptions; resolve(pcm: PcmData): void; reject(error: Error): void; settled?: boolean }>;
const changed = vi.fn();
const pcm = (sampleRate = 48000): PcmData => ({ sampleRate, channels: [new Float32Array([0.25, -0.25]), new Float32Array([0.5, -0.5])] });

function fixture(lengths: number[]) {
  const p = createProject();
  for (const length of lengths) {
    const t = createTrack(p, 'instrument', { preset: 'sub_bass' });
    t.clips.push(createMidiClip(p, 8, length));
    p.tracks.push(t);
  }
  return p;
}

async function finish(index: number, error?: Error) {
  const job = jobs[index];
  job.settled = true;
  if (error) job.reject(error);
  else job.resolve(pcm(job.opts.sampleRate));
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal('navigator', { hardwareConcurrency: 3 });
  vi.stubGlobal('AudioBuffer', class {
    readonly length: number;
    readonly numberOfChannels: number;
    readonly sampleRate: number;
    private channels: Float32Array[];
    constructor(opts: AudioBufferOptions) {
      this.length = opts.length;
      this.numberOfChannels = opts.numberOfChannels ?? 1;
      this.sampleRate = opts.sampleRate;
      this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
    }
    copyToChannel(data: Float32Array, channel: number) { this.channels[channel].set(data); }
    getChannelData(channel: number) { return this.channels[channel]; }
  });
  jobs = [];
  render.mockImplementation((project: Project, opts: RenderOptions) => new Promise<PcmData>((resolve, reject) => {
    jobs.push({ project, opts, resolve, reject });
  }));
  freeze = await import('./freeze');
  freeze.configureFreeze(48000, changed);
});

afterEach(async () => {
  vi.clearAllTimers();
  for (let i = 0; i < jobs.length; i++) if (!jobs[i].settled) await finish(i);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('background freezing', () => {
  it('overlaps bounded renders, starts longest tracks first, and fills freed slots without duplicates', async () => {
    const p = fixture([4, 32, 8, 16, 2]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs.map((j) => j.opts.onlyTracks)).toEqual([[p.tracks[1].id], [p.tracks[3].id]]);
    await finish(0);
    expect(jobs).toHaveLength(3);
    expect(jobs[2].opts.onlyTracks).toEqual([p.tracks[2].id]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(3);
    for (let i = 1; i < jobs.length; i++) await finish(i);
    expect(jobs).toHaveLength(5);
    expect(new Set(jobs.map((j) => j.opts.onlyTracks![0])).size).toBe(5);
    for (const t of p.tracks) {
      const f = freeze.frozenFor(p, t)!;
      expect(f.startBeat).toBe(8);
      expect(f.buffer.getChannelData(0)).toEqual(pcm().channels[0]);
    }
    expect(changed).toHaveBeenCalledTimes(5);
  });

  it.each([[1, 1], [2, 1], [16, 4]])('uses %i cores with at most %i active renders', async (cores, active) => {
    vi.stubGlobal('navigator', { hardwareConcurrency: cores });
    freeze.scheduleFreeze(fixture([4, 4, 4, 4, 4]));
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(active);
  });

  it.each([
    'Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15',
    'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1',
    'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/130.0 Mobile Safari/604.1',
    'Mozilla/5.0 (iPad) AppleWebKit/605.1.15 FxiOS/130.0 Mobile Safari/605.1.15',
  ])('serializes background audio contexts on WebKit: %s', async (userAgent) => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, userAgent });
    freeze.scheduleFreeze(fixture([8, 4, 2]));
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(1);
    await finish(0);
    expect(jobs).toHaveLength(2);
  });

  it('keeps desktop Chromium renders concurrent', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, userAgent: 'Mozilla/5.0 AppleWebKit/537.36 Chrome/130.0 Safari/537.36' });
    freeze.scheduleFreeze(fixture([8, 4, 2]));
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(3);
  });

  it('skips oversized renders before allocation and still freezes smaller tracks', async () => {
    const p = fixture([4096, 4]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].opts.onlyTracks).toEqual([p.tracks[1].id]);
    await finish(0);
    expect(freeze.frozenFor(p, p.tracks[0])).toBeNull();
    expect(freeze.frozenFor(p, p.tracks[1])).not.toBeNull();
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(1);
  });

  it('bounds in-flight PCM memory even when more CPU workers are available', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8 });
    // Each 60-second stereo render plus cache copy needs roughly 45 MiB.
    const p = fixture([140, 140, 140]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(1);
    await finish(0);
    expect(jobs).toHaveLength(2);
    await finish(1);
    expect(jobs).toHaveLength(3);
  });

  it('includes release tails and the playback sample rate in allocation estimates', async () => {
    const p = fixture([100, 4]);
    p.tracks[0].instrument!.params.release = 40;
    freeze.configureFreeze(96000, changed);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].opts.onlyTracks).toEqual([p.tracks[1].id]);
  });

  it('checks the WebKit cache budget before starting another native render', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, userAgent: 'AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15' });
    const p = fixture([120, 120, 120, 120]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    const frames = Math.ceil((120 * 60 / p.bpm + 1.5) * 48000);
    for (let i = 0; i < 3; i++) {
      jobs[i].settled = true;
      jobs[i].resolve({ sampleRate: 48000, channels: [new Float32Array(frames), new Float32Array(frames)] });
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(jobs).toHaveLength(3);
    expect(p.tracks.filter((t) => freeze.frozenFor(p, t))).toHaveLength(3);
  });

  it('retries a track skipped for size after it is shortened', async () => {
    const p = fixture([4096]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(0);
    const next = { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, length: 4 })) })) };
    freeze.scheduleFreeze(next);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(1);
    await finish(0);
    expect(freeze.frozenFor(next, next.tracks[0])).not.toBeNull();
  });

  it('does not let mixer or UI edits postpone freezing and keeps mixer controls live', async () => {
    const p = fixture([4]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(800);
    const next = { ...p, tracks: p.tracks.map((t) => ({ ...t, volumeDb: -24, pan: 0.7, mute: true, solo: true, name: 'Renamed', color: '#fff' })) };
    freeze.scheduleFreeze(next);
    await vi.advanceTimersByTimeAsync(400);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].project.tracks[0]).toMatchObject({ volumeDb: 0, pan: 0, mute: false, solo: false });
    expect(jobs[0].opts).toMatchObject({ startBeat: 8, endBeat: 12, master: false, reuseFrozen: false });
    await finish(0);
    expect(freeze.frozenFor(next, next.tracks[0])).not.toBeNull();
    freeze.scheduleFreeze(next);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(1);
  });

  it('debounces sound edits before starting work', async () => {
    const p = fixture([4]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(800);
    const next = { ...p, bpm: p.bpm + 10 };
    freeze.scheduleFreeze(next);
    await vi.advanceTimersByTimeAsync(1199);
    expect(jobs).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(jobs[0].project.bpm).toBe(next.bpm);
  });

  it('discards an edited in-flight render and freezes the latest sound', async () => {
    const p = fixture([4]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    const next = { ...p, bpm: p.bpm + 10 };
    freeze.scheduleFreeze(next);
    await finish(0);
    expect(freeze.frozenFor(next, next.tracks[0])).toBeNull();
    expect(changed).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(2);
    expect(jobs[1].project.bpm).toBe(next.bpm);
    await finish(1);
    expect(freeze.frozenFor(next, next.tracks[0])).not.toBeNull();
  });

  it('rejects old renders even when switching away and back to the same project', async () => {
    const p = fixture([4]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    freeze.scheduleFreeze({ ...p, id: 'other' });
    freeze.scheduleFreeze(p);
    await finish(0);
    expect(changed).not.toHaveBeenCalled();
    expect(jobs).toHaveLength(2);
    await finish(1);
    expect(freeze.frozenFor(p, p.tracks[0])).not.toBeNull();
  });

  it('does not install audio rendered at an obsolete sample rate', async () => {
    const p = fixture([4]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    freeze.configureFreeze(44100, changed);
    freeze.scheduleFreeze(p);
    await finish(0);
    expect(changed).not.toHaveBeenCalled();
    expect(jobs[1].opts.sampleRate).toBe(44100);
    await finish(1);
    expect(freeze.frozenFor(p, p.tracks[0])?.buffer.sampleRate).toBe(44100);
  });

  it('reports the playback rate that exports should render at', () => {
    freeze.configureFreeze(44100, changed);
    expect(freeze.playbackSampleRate()).toBe(44100);
    freeze.configureFreeze(48000, changed);
    expect(freeze.playbackSampleRate()).toBe(48000);
  });

  it('isolates failures and retries only after the failed sound changes', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = fixture([8, 4]);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    await finish(0, new Error('render failed'));
    await finish(1);
    freeze.scheduleFreeze(p);
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(2);
    expect(freeze.frozenFor(p, p.tracks[1])).not.toBeNull();
    freeze.scheduleFreeze({ ...p, bpm: p.bpm + 10 });
    await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(4);
    vi.restoreAllMocks();
  });
});

describe('edited freeze cache', () => {
  it('releases invalid buffers before reserving new mobile freezes', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 8, userAgent: 'Android Chrome/140 Mobile AppleWebKit/537.36' });
    const p = fixture([120, 120, 120]);
    freeze.scheduleFreeze(p); await vi.advanceTimersByTimeAsync(1200);
    const frames = Math.ceil((120 * 60 / p.bpm + 1.5) * 48000);
    for (let i = 0; i < 3; i++) {
      jobs[i].settled = true; jobs[i].resolve({ sampleRate: 48000, channels: [new Float32Array(frames), new Float32Array(frames)] });
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(jobs).toHaveLength(3);
    const next = { ...p, bpm: p.bpm + 1 };
    freeze.scheduleFreeze(next); await vi.advanceTimersByTimeAsync(1200);
    expect(jobs).toHaveLength(4);
    expect(freeze.frozenFor(next, next.tracks[0])).toBeNull();
  });
});
