import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../model/project';
import { base64ToArrayBuffer } from '../engine/wav';
const mocks = vi.hoisted(() => ({
  render: vi.fn(), generate: vi.fn(),
  settings: { listeningQuality: 'full', listeningChannels: 'stereo' },
}));
vi.mock('../engine/api', () => ({ renderProject: mocks.render }));
vi.mock('./llm', () => ({ generateText: mocks.generate }));
vi.mock('../state/settings', () => ({ useSettings: { getState: () => mocks.settings } }));
import { listen } from './ears';

beforeEach(() => {
  mocks.generate.mockReset().mockResolvedValue('Keep the bass in tune.');
  mocks.render.mockReset().mockResolvedValue({ sampleRate: 44100, channels: [new Float32Array(4410).fill(0.1), new Float32Array(4410).fill(-0.05)] });
  mocks.settings.listeningQuality = 'full'; mocks.settings.listeningChannels = 'stereo';
});

describe('ears audio parity', () => {
  it('defaults to a short excerpt and a compact critique while honoring explicit ranges', async () => {
    const p = createProject();
    const { createTrack, createMidiClip } = await import('../model/project');
    const t = createTrack(p, 'instrument'); t.clips.push(createMidiClip(p, 0, 256)); p.tracks.push(t);
    p.bpm = 60;
    await listen({ project: p });
    expect(mocks.render.mock.calls[0][1].endBeat).toBe(12);
    expect(mocks.generate.mock.calls[0][0].maxOutputTokens).toBe(700);
    await listen({ project: p, startBar: 1, endBar: 9 });
    expect(mocks.render.mock.calls[1][1].endBeat).toBe(32);
  });
  it('does not spend a model call on a measured silent render', async () => {
    mocks.render.mockResolvedValueOnce({ sampleRate: 44100, channels: [new Float32Array(4410)] });
    const result = await listen({ project: createProject() });
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(result.heard).toContain('silent');
  });
  it('sends full-quality stereo to the model and retains only text findings', async () => {
    const result = await listen({ project: createProject(), startBar: 1, endBar: 2 });
    const request = mocks.generate.mock.calls[0][0];
    const sent = base64ToArrayBuffer(request.contents[0].parts[0].inlineData.data);
    expect(new DataView(sent).getUint16(22, true)).toBe(2);
    expect(new DataView(sent).getUint32(24, true)).toBe(44100);
    expect(result.heard).toBe('Keep the bass in tune.');
    expect(result).not.toHaveProperty('reviewId');
    expect(JSON.stringify(result)).not.toContain('inlineData');
  });
  it('reuses a mix critique without retaining or regenerating chat audio', async () => {
    const project = createProject();
    const first = await listen({ project, startBar: 1, endBar: 2 });
    expect(await listen({ project, startBar: 1, endBar: 2 })).toBe(first);
    expect(mocks.render).toHaveBeenCalledTimes(1);
    expect(mocks.generate).toHaveBeenCalledTimes(1);
    mocks.settings.listeningChannels = 'mono';
    await listen({ project, startBar: 1, endBar: 2 });
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });
  it('honors compact mono and tells the critic that stereo cannot be evaluated', async () => {
    mocks.settings.listeningQuality = 'compact'; mocks.settings.listeningChannels = 'mono';
    await listen({ project: createProject() });
    const request = mocks.generate.mock.calls[0][0];
    const sent = new DataView(base64ToArrayBuffer(request.contents[0].parts[0].inlineData.data));
    expect(sent.getUint16(22, true)).toBe(1);
    expect(sent.getUint32(24, true)).toBe(16000);
    expect(JSON.stringify(request)).toContain('do not judge stereo');
  });
});
