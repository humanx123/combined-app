// Time-stretch without changing pitch (WSOLA: waveform-similarity overlap-add).
// Runs once per (sample, ratio) and is cached, so stretched loops sound identical in
// playback and in bounces - and at full level, unlike granular playback.

const FRAME = 2048;
const HOP_OUT = FRAME / 2;
const TOLERANCE = 512;
const DECIMATE = 4;

const hann = (() => {
  const w = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME);
  return w;
})();

/**
 * Stretch audio so it plays `speed` times faster (speed 1.25 → 80% as long).
 * Channels are aligned using a mono mix so the stereo image stays intact.
 */
export function wsola(channels: Float32Array[], speed: number): Float32Array[] {
  if (!Number.isFinite(speed) || speed <= 0) throw new RangeError('Stretch speed must be finite and positive.');
  if (channels.some((c) => c.length !== channels[0].length)) throw new RangeError('Audio channels must have equal lengths.');
  if (!channels.length || Math.abs(speed - 1) < 1e-4) return channels.map((c) => c.slice());
  const inLen = channels[0].length;
  const outLen = Math.max(1, Math.round(inLen / speed));
  const hopIn = HOP_OUT * speed;
  const mono = new Float32Array(inLen);
  for (const ch of channels) for (let i = 0; i < inLen; i++) mono[i] += ch[i] / channels.length;

  const out = channels.map(() => new Float32Array(outLen + FRAME));
  const norm = new Float32Array(outLen + FRAME);
  let prevPos = 0; // where the previous frame was taken from
  let outPos = 0;
  let frame = 0;
  while (outPos < outLen) {
    const ideal = Math.round(frame * hopIn);
    let pos = ideal;
    if (frame > 0) {
      // The audio that would naturally follow the previous frame:
      const natural = prevPos + HOP_OUT;
      let best = -Infinity;
      const lo = Math.max(0, ideal - TOLERANCE);
      const hi = Math.min(inLen - FRAME, ideal + TOLERANCE);
      for (let cand = lo; cand <= hi; cand += DECIMATE) {
        let c = 0;
        for (let k = 0; k < HOP_OUT; k += DECIMATE) {
          const a = natural + k < inLen ? mono[natural + k] : 0;
          c += a * mono[cand + k];
        }
        if (c > best) { best = c; pos = cand; }
      }
    }
    pos = Math.max(0, Math.min(Math.max(0, inLen - 1), pos));
    for (let k = 0; k < FRAME; k++) {
      const src = pos + k;
      if (src >= inLen) break;
      const w = hann[k];
      for (let c = 0; c < channels.length; c++) out[c][outPos + k] += channels[c][src] * w;
      norm[outPos + k] += w;
    }
    prevPos = pos;
    outPos += HOP_OUT;
    frame++;
  }
  return out.map((ch) => {
    const res = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) res[i] = norm[i] > 1e-3 ? ch[i] / norm[i] : ch[i];
    return res;
  });
}

const cache = new Map<string, { source: AudioBuffer; buffer: AudioBuffer; bytes: number }>();
const CACHE_BYTES = 128 * 1024 * 1024;
let cacheBytes = 0;

/** Cached stretched copy of `buf` playing `speed`× faster at the same pitch. */
export function stretchedBuffer(key: string, buf: AudioBuffer, speed: number): AudioBuffer {
  const k = `${key}|${speed}`;
  const entry = cache.get(k);
  if (entry?.source === buf) {
    cache.delete(k); cache.set(k, entry); // LRU eviction keeps actively used loops warm.
    return entry.buffer;
  }
  if (entry) { cacheBytes -= entry.bytes; cache.delete(k); }
    const chans: Float32Array[] = [];
    for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
    const res = wsola(chans, speed);
    const hit = new AudioBuffer({ length: res[0].length, numberOfChannels: res.length, sampleRate: buf.sampleRate });
    res.forEach((d, i) => hit.copyToChannel(d as Float32Array<ArrayBuffer>, i));
    const bytes = hit.length * hit.numberOfChannels * 4;
    while (cache.size && (cacheBytes + bytes > CACHE_BYTES || cache.size >= 64)) {
      const oldest = cache.keys().next().value!;
      cacheBytes -= cache.get(oldest)!.bytes;
      cache.delete(oldest);
    }
    if (bytes <= CACHE_BYTES) { cache.set(k, { source: buf, buffer: hit, bytes }); cacheBytes += bytes; }
  return hit;
}
