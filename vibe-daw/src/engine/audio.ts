import type { AudioClip } from '../model/types';
import { getLoadedBuffer, getSampleMeta } from '../samples/library';
import { reverseBuffer } from '../samples/synth';
import { stretchedBuffer } from './stretch';

export interface PreparedAudio { buffer: AudioBuffer; rate: number; offsetScale: number }
const reversed = new WeakMap<AudioBuffer, AudioBuffer>();
const prepared = new WeakMap<AudioClip, { raw: AudioBuffer; tempo: number; value: PreparedAudio }>();

/** Resolve expensive DSP while syncing, never inside a transport callback. */
export function prepareAudio(clip: AudioClip, bpm: number): PreparedAudio | null {
  const raw = getLoadedBuffer(clip.sampleId);
  if (!raw) return null;
  const sampleBpm = getSampleMeta(clip.sampleId)?.bpm;
  const tempo = clip.warp !== 'off' && sampleBpm ? bpm / sampleBpm : 1;
  const cached = prepared.get(clip);
  if (cached?.raw === raw && cached.tempo === tempo) return cached.value;
  const pitch = Math.pow(2, clip.pitch / 12);
  const speed = clip.warp === 'stretch' ? tempo / pitch : 1;
  let buffer = raw;
  if (clip.reverse) {
    let hit = reversed.get(raw);
    if (!hit) { hit = reverseBuffer(raw); reversed.set(raw, hit); }
    buffer = hit;
  }
  if (Math.abs(speed - 1) > 1e-3) buffer = stretchedBuffer(`${clip.sampleId}|${clip.reverse}`, buffer, speed);
  const value = { buffer, rate: clip.warp === 'stretch' ? pitch : tempo * pitch, offsetScale: Math.abs(speed - 1) > 1e-3 ? 1 / speed : 1 };
  prepared.set(clip, { raw, tempo, value });
  return value;
}

/** Clamp overlapping fades and preserve their level when playback starts mid-clip. */
export function fadeEnvelope(duration: number, fadeIn: number, fadeOut: number, elapsed = 0) {
  let a = Math.max(0.002, fadeIn), b = Math.max(0.005, fadeOut);
  const scale = Math.min(1, duration / (a + b));
  a *= scale;
  b *= scale;
  const level = Math.max(0, Math.min(1, a ? elapsed / a : 1, b ? (duration - elapsed) / b : 1));
  return { level, attack: Math.max(0, a - elapsed), release: Math.max(0, duration - b - elapsed), end: Math.max(0, duration - elapsed) };
}
