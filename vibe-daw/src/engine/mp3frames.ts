// Parallel MP3 encoding plan. lamejs runs LAME with the bit reservoir disabled, so
// every frame is self-contained and chunks encoded by separate workers can be joined
// frame by frame. Each chunk's encoder starts a few frames early, so its MDCT overlap
// and psychoacoustic state have warmed up by the first frame it keeps, and on a
// multiple of the CBR padding cycle, so its frame sizes line up with a single pass.
// On typical material the joined file is byte-identical to a single pass. Where LAME's
// slow-adapting loudness state hasn't converged (near-silence after a loud hit), a few
// frames after a seam quantize differently, with the same coding error.
// No lamejs import here: the main thread only plans; workers encode.

/** Samples per MPEG-1 Layer III frame. */
export const FRAME = 1152;
/** About half a second: long enough for LAME's adaptive state to settle on typical material. */
const LEAD_FRAMES = 24;
/** Extra input after a chunk so LAME emits all its frames without a flush. */
const TRAIL_FRAMES = 3;
const MIN_CHUNK_FRAMES = 256;

export interface Mp3Chunk {
  /** Input sample range to feed the encoder. */
  from: number;
  to: number;
  /** Leading warm-up frames to drop. */
  skip: number;
  /** Frames to keep after those, or null for the last chunk: everything, then flush. */
  keep: number | null;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Split an encode of `samples` stereo frames into at most `parts` chunks. */
export function planMp3Chunks(samples: number, sampleRate: number, kbps: number, parts: number, minChunkFrames = MIN_CHUNK_FRAMES): Mp3Chunk[] {
  const frames = Math.ceil(samples / FRAME);
  const n = Math.max(1, Math.min(Math.floor(parts), Math.floor(frames / minChunkFrames)));
  // Lower rates switch to MPEG-2 (576-sample frames); those just encode in one pass.
  if (n === 1 || ![32000, 44100, 48000].includes(sampleRate)) return [{ from: 0, to: samples, skip: 0, keep: null }];
  // CBR frames alternate between N and N+1 bytes in a cycle of `period` frames.
  const frac = (144 * kbps * 1000) % sampleRate;
  const period = frac ? sampleRate / gcd(frac, sampleRate) : 1;
  const starts = [0];
  for (let c = 1; c < n; c++) {
    const b = Math.round((c * frames / n - LEAD_FRAMES) / period) * period + LEAD_FRAMES;
    if (b > starts[starts.length - 1] && b + TRAIL_FRAMES < frames) starts.push(b);
  }
  return starts.map((start, c) => {
    const skip = c ? LEAD_FRAMES : 0;
    const from = (start - skip) * FRAME;
    if (c === starts.length - 1) return { from, to: samples, skip, keep: null };
    const end = starts[c + 1];
    return { from, to: (end + TRAIL_FRAMES) * FRAME, skip, keep: end - start };
  });
}

const BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const RATES = [44100, 48000, 32000];

/** Split an MPEG-1 Layer III stream into frames. Throws on anything else. */
export function splitFrames(bytes: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let p = 0;
  while (p < bytes.length) {
    // Sync word, MPEG-1, Layer III.
    if (p + 4 > bytes.length || bytes[p] !== 0xff || (bytes[p + 1] & 0xfe) !== 0xfa) throw new Error(`MP3 stream lost sync at byte ${p}`);
    const kbps = BITRATES[bytes[p + 2] >> 4], rate = RATES[(bytes[p + 2] >> 2) & 3];
    if (!kbps || !rate) throw new Error(`Unsupported MP3 frame header at byte ${p}`);
    const len = Math.floor(144 * kbps * 1000 / rate) + ((bytes[p + 2] >> 1) & 1);
    if (p + len > bytes.length) throw new Error('Truncated MP3 frame');
    frames.push(bytes.subarray(p, p + len));
    p += len;
  }
  return frames;
}
