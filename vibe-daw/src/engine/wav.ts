// WAV encoding and small buffer utilities. Pure functions over Float32 data so they
// work on AudioBuffers and in tests alike.

export interface PcmData {
  sampleRate: number;
  channels: Float32Array[];
}

export function audioBufferToPcm(buf: AudioBuffer, maxSeconds = Infinity): PcmData {
  const channels: Float32Array[] = [];
  const end = Math.min(buf.length, Math.ceil(Math.max(0, maxSeconds) * buf.sampleRate));
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c).slice(0, end));
  return { sampleRate: buf.sampleRate, channels };
}

export function encodeWav(pcm: PcmData, bitDepth: 16 | 24 = 16): ArrayBuffer {
  const { sampleRate, channels } = pcm;
  const numCh = channels.length;
  const len = channels[0]?.length ?? 0;
  const bytes = bitDepth / 8;
  const dataSize = len * numCh * bytes;
  const buffer = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buffer);
  const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * numCh * bytes, true);
  v.setUint16(32, numCh * bytes, true);
  v.setUint16(34, bitDepth, true);
  writeStr(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      if (bitDepth === 16) {
        v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      } else {
        const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        v.setUint8(o, x & 0xff);
        v.setUint8(o + 1, (x >> 8) & 0xff);
        v.setUint8(o + 2, (x >> 16) & 0xff);
      }
      o += bytes;
    }
  }
  return buffer;
}

/** Mix to mono and resample (linear interpolation, with a simple box low-pass when decimating). */
export function toMono(pcm: PcmData, targetRate = pcm.sampleRate): PcmData {
  const n = pcm.channels[0]?.length ?? 0;
  const mono = new Float32Array(n);
  for (const ch of pcm.channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / pcm.channels.length;
  if (targetRate === pcm.sampleRate) return { sampleRate: targetRate, channels: [mono] };
  return { sampleRate: targetRate, channels: [resample(mono, pcm.sampleRate, targetRate)] };
}

export function resample(data: Float32Array, from: number, to: number): Float32Array {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to <= 0) throw new RangeError('Sample rates must be finite and positive.');
  const ratio = from / to;
  const outLen = Math.floor(data.length / ratio);
  const out = new Float32Array(outLen);
  const kernels = ratio > 1 ? resampleKernels(ratio) : null;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    if (kernels) {
      const start = Math.floor(pos);
      const kernel = kernels[Math.min(255, Math.floor((pos - start) * 256))];
      let value = 0, weight = 0;
      for (let k = 0; k < kernel.length; k++) {
        const at = start + k - 15;
        if (at >= 0 && at < data.length) { value += data[at] * kernel[k]; weight += kernel[k]; }
      }
      out[i] = weight ? value / weight : 0;
    } else {
      const i0 = Math.floor(pos);
      const f = pos - i0;
      out[i] = data[i0] * (1 - f) + (data[i0 + 1] ?? data[i0]) * f;
    }
  }
  return out;
}

const kernelCache = new Map<number, Float64Array[]>();
function resampleKernels(ratio: number): Float64Array[] {
  let kernels = kernelCache.get(ratio);
  if (kernels) return kernels;
  // A windowed sinc low-pass removes frequencies above the new Nyquist limit,
  // preventing bright hats/sibilance from aliasing into the AI's midrange.
  const cutoff = 0.94 / ratio;
  kernels = Array.from({ length: 256 }, (_, phase) => Float64Array.from({ length: 32 }, (_, k) => {
    const distance = k - 15 - phase / 256;
    const x = Math.PI * cutoff * distance;
    return cutoff * (Math.abs(x) < 1e-10 ? 1 : Math.sin(x) / x) * (0.5 + 0.5 * Math.cos(Math.PI * distance / 16));
  }));
  if (kernelCache.size >= 16) kernelCache.delete(kernelCache.keys().next().value!);
  kernelCache.set(ratio, kernels);
  return kernels;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Trim a PCM buffer to [startSec, endSec). */
export function slicePcm(pcm: PcmData, startSec: number, endSec: number): PcmData {
  const a = Math.max(0, Math.floor(startSec * pcm.sampleRate));
  const b = Math.min(pcm.channels[0].length, Math.floor(endSec * pcm.sampleRate));
  return { sampleRate: pcm.sampleRate, channels: pcm.channels.map((c) => c.slice(a, b)) };
}

/** Short fade in/out to avoid clicks at slice points. */
export function applyEdgeFades(pcm: PcmData, fadeSec = 0.004): PcmData {
  const n = Math.floor(fadeSec * pcm.sampleRate);
  for (const ch of pcm.channels) {
    const len = ch.length;
    for (let i = 0; i < n && i < len; i++) {
      const g = i / n;
      ch[i] *= g;
      ch[len - 1 - i] *= g;
    }
  }
  return pcm;
}

export function pcmToAudioBuffer(pcm: PcmData): AudioBuffer {
  const buf = new AudioBuffer({ length: pcm.channels[0].length, numberOfChannels: pcm.channels.length, sampleRate: pcm.sampleRate });
  pcm.channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return buf;
}
