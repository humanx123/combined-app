import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAudioClip, createMidiClip, createProject, createTrack } from '../model/project';
const mocks = vi.hoisted(() => ({ render: vi.fn(), buffer: { duration: 1 }, revision: 0 }));
vi.mock('./render', () => ({ renderProject: mocks.render }));
vi.mock('../samples/library', () => ({ getLoadedBuffer: () => mocks.buffer, loadBuffer: async () => mocks.buffer, getAudioRevision: () => mocks.revision }));
import { renderSamplePreview } from './samplePreview';

beforeEach(() => mocks.render.mockReset().mockResolvedValue({ sampleRate: 44100, channels: [new Float32Array(441), new Float32Array(441)] }));
describe('sample audition playback', () => {
  it('keeps the audio clip pitch, warp, offsets, gain and effect chain', async () => {
    const p = createProject();
    const t = createTrack(p, 'audio');
    const c = createAudioClip(p, 's1', 4, 8);
    c.pitch = -5; c.offset = 0.3; c.warp = 'stretch'; c.gainDb = -8;
    t.pan = -0.2; t.volumeDb = -10;
    t.effects.push({ id: 'fx40', type: 'filter', enabled: true, params: { frequency: 800, mode: 'lowpass' } });
    t.clips.push(c); p.tracks.push(t);
    await renderSamplePreview(p, 's1');
    const rendered = mocks.render.mock.calls[0][0];
    expect(rendered.tracks[0]).toEqual(t);
    expect(rendered.master).toBe(p.master);
    expect(mocks.render.mock.calls[0][1].startBeat).toBe(4);
    expect(mocks.render.mock.calls[0][1].onlyTracks).toEqual([t.id]);
  });
  it('keeps a drum lane tuning, gain and original hit velocity', async () => {
    const p = createProject();
    const t = createTrack(p, 'drums');
    const lane = t.drumLanes![0]; lane.pitch = 7; lane.gainDb = -12;
    const c = createMidiClip(p, 0, 4);
    c.notes.push({ id: 'n', pitch: lane.note, start: 1, duration: 0.2, velocity: 0.3 });
    t.clips.push(c); p.tracks.push(t);
    await renderSamplePreview(p, lane.sampleId);
    const rendered = mocks.render.mock.calls[0][0];
    expect(rendered.tracks[0].drumLanes[0]).toEqual(lane);
    expect(rendered.tracks[0].clips[0].notes).toEqual(c.notes);
    expect(mocks.render.mock.calls[0][1].startBeat).toBe(1);
  });
  it('shares preview PCM and invalidates it when source audio changes', async () => {
    const p = createProject();
    const a = await renderSamplePreview(p, 'unused');
    const b = await renderSamplePreview(p, 'unused');
    expect(a).toBe(b);
    expect(mocks.render).toHaveBeenCalledTimes(1);
    ++mocks.revision;
    await renderSamplePreview(p, 'unused');
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });
});
