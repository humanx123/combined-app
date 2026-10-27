// Deterministic convolution impulses, shared by live playback and offline graphs.
// Avoids a fresh random impulse and an extra offline render for every bounce.
export function impulseChannels(rate: number, decay: number, preDelay: number, identity: string): Float32Array[] {
  const length = Math.max(1, Math.ceil((decay + preDelay) * rate));
  const timeConstant = Math.log(decay + 1) / Math.log(200);
  const linearStart = decay * 0.9;
  const linearLevel = Math.exp(-linearStart / timeConstant);
  return [0, 1].map((channel) => {
    const data = new Float32Array(length);
    let seed = 2166136261 ^ (channel + 1) * 0x9e3779b9;
    for (const c of identity) seed = Math.imul(seed ^ c.charCodeAt(0), 16777619);
    for (let i = Math.ceil(preDelay * rate); i < length; i++) {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const time = i / rate - preDelay;
      const envelope = time < linearStart ? Math.exp(-time / timeConstant) : linearLevel * Math.max(0, (decay - time) / (decay - linearStart));
      data[i] = ((seed >>> 0) / 0x80000000 - 1) * envelope;
    }
    return data;
  });
}

const cache = new Map<string, AudioBuffer>();
const MAX_BYTES = 64 * 1024 * 1024;
let bytes = 0;
export function reverbImpulse(rate: number, decay: number, preDelay: number, identity: string): AudioBuffer {
  const key = `${rate}|${decay}|${preDelay}|${identity}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const channels = impulseChannels(rate, decay, preDelay, identity);
  const buffer = new AudioBuffer({ length: channels[0].length, numberOfChannels: 2, sampleRate: rate });
  channels.forEach((c, i) => buffer.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  const size = buffer.length * 8;
  while (cache.size && (bytes + size > MAX_BYTES || cache.size >= 64)) {
    const oldest = cache.keys().next().value!;
    bytes -= cache.get(oldest)!.length * 8; cache.delete(oldest);
  }
  if (size <= MAX_BYTES) { cache.set(key, buffer); bytes += size; }
  return buffer;
}
