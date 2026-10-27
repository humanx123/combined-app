import { Mp3Encoder } from '@breezystack/lamejs';
import { FRAME, splitFrames, type Mp3Chunk } from './mp3frames';

// One chunk of a (possibly parallel) MP3 encode. Runs in the MP3 worker.

function toInt16(src: Float32Array, from: number, to: number): Int16Array {
  const out = new Int16Array(to - from);
  for (let i = from; i < to; i++) {
    const s = Math.max(-1, Math.min(1, src[i]));
    out[i - from] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

/** Encode `left`/`right` (already cut to the chunk's input range) and keep the chunk's frames. */
export function encodeMp3Chunk(left: Float32Array, right: Float32Array, sampleRate: number, kbps: number, chunk: Pick<Mp3Chunk, 'skip' | 'keep'>, onProgress?: (f: number) => void): Uint8Array {
  const enc = new Mp3Encoder(2, sampleRate, kbps);
  const parts: Uint8Array[] = [];
  const block = FRAME * 64;
  for (let i = 0; i < left.length; i += block) {
    const end = Math.min(left.length, i + block);
    const out = enc.encodeBuffer(toInt16(left, i, end), toInt16(right, i, end));
    if (out.length) parts.push(new Uint8Array(out));
    onProgress?.(end / left.length);
  }
  if (chunk.keep === null) {
    const last = enc.flush();
    if (last.length) parts.push(new Uint8Array(last));
  }
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  if (chunk.skip === 0 && chunk.keep === null) return bytes;
  const frames = splitFrames(bytes);
  if (chunk.keep !== null && frames.length < chunk.skip + chunk.keep) throw new Error('MP3 chunk ended early');
  const first = frames[chunk.skip], lastFrame = frames[chunk.keep === null ? frames.length - 1 : chunk.skip + chunk.keep - 1];
  if (!first || !lastFrame) return new Uint8Array(0);
  // Frames are contiguous views of `bytes`.
  return bytes.slice(first.byteOffset, lastFrame.byteOffset + lastFrame.length);
}
