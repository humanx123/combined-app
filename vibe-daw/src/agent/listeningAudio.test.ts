import { describe, expect, it } from 'vitest';
import { prepareListeningAudio } from './listeningAudio';
import { encodeWav } from '../engine/wav';

const pcm = { sampleRate: 44100, channels: [new Float32Array(44100).fill(0.2), new Float32Array(44100).fill(-0.1)] };
describe('listening quality', () => {
  it('preserves the full stereo PCM in the default WAV', () => {
    const result = prepareListeningAudio(pcm, 'full', 'stereo');
    expect(result.pcm).toBe(pcm);
    expect(result.wav).toEqual(encodeWav(pcm, 16));
    expect(new DataView(result.wav).getUint16(22, true)).toBe(2);
    expect(new DataView(result.wav).getUint32(24, true)).toBe(44100);
  });
  it('makes quality and channel count independent and crops before resampling', () => {
    const result = prepareListeningAudio(pcm, 'compact', 'mono', 0.5);
    expect(result.pcm.sampleRate).toBe(16000);
    expect(result.pcm.channels).toHaveLength(1);
    expect(result.pcm.channels[0]).toHaveLength(8000);
    expect(result.pcm.channels[0][200]).toBeCloseTo(0.05);
    expect(prepareListeningAudio(pcm, 'balanced', 'stereo').pcm.channels).toHaveLength(2);
    expect(prepareListeningAudio(pcm, 'full', 'mono').pcm.sampleRate).toBe(44100);
  });
});
