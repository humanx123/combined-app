// Objective audio analysis: tempo, key, pitch, loudness, spectral balance.
// The agent gets these numbers alongside what Gemini hears, so its decisions are
// grounded in both perception ("the 808 feels muddy") and measurement (sub 41% of energy).

import { detectKey, formatKey, midiToNote } from '../model/theory';
import type { PcmData } from '../engine/wav';

export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
}

const hann = (() => {
  const cache = new Map<number, Float64Array>();
  return (n: number) => {
    let w = cache.get(n);
    if (!w) {
      w = new Float64Array(n);
      for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      cache.set(n, w);
    }
    return w;
  };
})();

/** Iterate magnitude spectra over a mono signal. */
function forEachSpectrum(mono: Float32Array, size: number, hop: number, cb: (mag: Float64Array, frame: number) => void, maxFrames = Infinity) {
  const w = hann(size);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const mag = new Float64Array(size / 2);
  let frame = 0;
  for (let start = 0; start + size <= mono.length && frame < maxFrames; start += hop, frame++) {
    for (let i = 0; i < size; i++) { re[i] = mono[start + i] * w[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < size / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
    cb(mag, frame);
  }
}

function monoOf(pcm: PcmData): Float32Array {
  if (pcm.channels.length === 1) return pcm.channels[0];
  const n = pcm.channels[0].length;
  const out = new Float32Array(n);
  for (const c of pcm.channels) for (let i = 0; i < n; i++) out[i] += c[i] / pcm.channels.length;
  return out;
}

// ------------------------------------------------------------------ onsets & tempo

export function onsetEnvelope(mono: Float32Array, sr: number, hop = 512, size = 1024): { env: Float64Array; hopSec: number } {
  const frames = Math.max(0, Math.floor((mono.length - size) / hop) + 1);
  const env = new Float64Array(frames);
  const prev = new Float64Array(size / 2);
  forEachSpectrum(mono, size, hop, (mag, f) => {
    let flux = 0;
    for (let k = 1; k < mag.length; k++) {
      const value = Math.log1p(mag[k]);
      if (f > 0) flux += Math.max(0, value - prev[k]);
      prev[k] = value;
    }
    env[f] = flux;
  });
  return { env, hopSec: hop / sr };
}

export function estimateTempo(pcm: PcmData): { bpm: number; confidence: number; alternatives: number[] } | null {
  const mono = monoOf(pcm);
  if (mono.length < pcm.sampleRate * 2) return null;
  const { env, hopSec } = onsetEnvelope(mono, pcm.sampleRate);
  // remove local mean
  const smoothed = new Float64Array(env.length);
  const half = 8;
  for (let i = 0; i < env.length; i++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, i - half); k < Math.min(env.length, i + half); k++) { s += env[k]; c++; }
    smoothed[i] = Math.max(0, env[i] - s / c);
  }
  const scores: Array<{ bpm: number; score: number }> = [];
  const n = smoothed.length;
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const lag = 60 / bpm / hopSec;
    const limit = n - Math.ceil(lag * 4) - 1;
    if (limit <= 0) continue;
    let s = 0;
    for (let i = 0; i < limit; i++) {
      const l1 = Math.round(i + lag), l2 = Math.round(i + lag * 2), l4 = Math.round(i + lag * 4);
      s += smoothed[i] * (smoothed[l1] + 0.5 * smoothed[l2] + 0.25 * smoothed[l4]);
    }
    s /= limit; // normalize so short lags don't win just by having more terms
    // gentle prior toward common hip-hop / pop tempos
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    scores.push({ bpm, score: s * prior });
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (!best || !(best.score > 0)) return null;
  const mean = scores.reduce((a, b) => a + b.score, 0) / scores.length;
  if (!(mean > 0)) return null;
  const alternatives = [best.bpm / 2, best.bpm * 2].filter((b) => b >= 50 && b <= 220);
  return { bpm: Math.round(best.bpm * 2) / 2, confidence: Math.min(1, (best.score / mean - 1) / 3), alternatives };
}

/** Time in seconds of the first strong transient - where a loop's downbeat probably is. */
export function firstOnset(pcm: PcmData, threshold = 0.2): number {
  const mono = monoOf(pcm);
  const { env, hopSec } = onsetEnvelope(mono, pcm.sampleRate, 256, 512);
  let max = 0;
  for (const v of env) max = Math.max(max, v);
  for (let i = 0; i < env.length; i++) if (env[i] > max * threshold) return Math.max(0, (i - 1) * hopSec);
  return 0;
}

// ------------------------------------------------------------------ key & pitch

export function chroma(pcm: PcmData, maxSeconds = 30): number[] {
  const mono = monoOf(pcm);
  const size = 8192;
  const sr = pcm.sampleRate;
  const bins = new Array(12).fill(0);
  const maxFrames = Math.floor((maxSeconds * sr) / (size / 2));
  forEachSpectrum(mono, size, size / 2, (mag) => {
    for (let k = 1; k < mag.length; k++) {
      const f = (k * sr) / size;
      if (f < 55 || f > 4200) continue;
      const midi = 69 + 12 * Math.log2(f / 440);
      const pc = ((Math.round(midi) % 12) + 12) % 12;
      bins[pc] += mag[k] * mag[k];
    }
  }, maxFrames);
  const total = bins.reduce((a, b) => a + b, 0) || 1;
  return bins.map((b) => b / total);
}

export function estimateKey(pcm: PcmData): { key: string; confidence: number } | null {
  const c = chroma(pcm);
  if (c.every((v) => !isFinite(v) || v === 0)) return null;
  const { key, confidence } = detectKey(c);
  return { key: formatKey(key), confidence };
}

/** Fundamental of a pitched one-shot (808s, bass notes, keys hits). */
export function estimatePitch(pcm: PcmData): { midi: number; note: string; hz: number } | null {
  const sourceRate = pcm.sampleRate;
  const step = Math.max(1, Math.floor(sourceRate / 11025));
  const sr = sourceRate / step;
  const start = Math.floor(0.04 * sourceRate);
  const len = Math.floor(Math.min(0.25 * sourceRate, (pcm.channels[0]?.length ?? 0) - start) / step);
  if (len < 512) return null;
  // Low-pass and decimate only the analysis window. YIN's quadratic work does not
  // need 44/96 kHz data, and mixing an entire reference track here wastes memory.
  const x = new Float32Array(len);
  let energy = 0;
  for (let i = 0; i < len; i++) {
    let value = 0;
    for (const ch of pcm.channels) for (let k = 0; k < step; k++) value += ch[start + i * step + k];
    x[i] = value / (step * pcm.channels.length);
    energy += x[i] * x[i];
  }
  if (energy / len < 1e-10) return null;
  const minLag = Math.floor(sr / 1200), maxLag = Math.floor(sr / 25);
  // YIN difference function
  const d = new Float64Array(maxLag + 1);
  for (let tau = 1; tau <= maxLag; tau++) {
    let s = 0;
    for (let i = 0; i + tau < x.length; i++) { const diff = x[i] - x[i + tau]; s += diff * diff; }
    d[tau] = s;
  }
  let running = 0;
  let bestTau = -1;
  for (let tau = 1; tau <= maxLag; tau++) {
    running += d[tau];
    const cmnd = (d[tau] * tau) / (running || 1);
    if (tau >= minLag && cmnd < 0.15) {
      while (tau + 1 <= maxLag && d[tau + 1] < d[tau]) tau++;
      bestTau = tau;
      break;
    }
  }
  if (bestTau < 0) return null;
  const left = d[bestTau - 1], mid = d[bestTau], right = d[bestTau + 1];
  const curvature = left - 2 * mid + right;
  const offset = curvature && Number.isFinite(right) ? Math.max(-0.5, Math.min(0.5, (left - right) / (2 * curvature))) : 0;
  const hz = sr / (bestTau + offset);
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  return { midi, note: midiToNote(midi), hz: Math.round(hz * 10) / 10 };
}

// ------------------------------------------------------------------ loudness & balance

export interface MixStats {
  peakDb: number;
  rmsDb: number;
  crestDb: number;
  /** Percent of spectral energy in each band. */
  bands: { sub: number; low: number; lowMid: number; mid: number; presence: number; air: number };
  /** -1..1, 1 = mono-compatible/identical channels. */
  stereoCorrelation: number | null;
  /** Fraction of time the signal is effectively silent. */
  silence: number;
  durationSec: number;
}

const BAND_EDGES: Array<[keyof MixStats['bands'], number, number]> = [
  ['sub', 20, 60], ['low', 60, 250], ['lowMid', 250, 1000], ['mid', 1000, 4000], ['presence', 4000, 8000], ['air', 8000, 20000],
];

const db = (x: number) => (x > 0 ? Math.round(20 * Math.log10(x) * 10) / 10 : -120);

export function mixStats(pcm: PcmData): MixStats {
  const mono = monoOf(pcm);
  const sr = pcm.sampleRate;
  let peak = 0, sumSq = 0, silent = 0;
  const block = Math.floor(sr * 0.05);
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
    sumSq += mono[i] * mono[i];
  }
  for (let b = 0; b + block <= mono.length; b += block) {
    let s = 0;
    for (let i = b; i < b + block; i++) s += mono[i] * mono[i];
    if (Math.sqrt(s / block) < 0.001) silent++;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, mono.length));
  const energy: Record<string, number> = { sub: 0, low: 0, lowMid: 0, mid: 0, presence: 0, air: 0 };
  const size = 4096;
  const maxFrames = 400;
  const hop = Math.max(size, Math.floor((mono.length - size) / maxFrames));
  forEachSpectrum(mono, size, hop, (mag) => {
    for (let k = 1; k < mag.length; k++) {
      const f = (k * sr) / size;
      const band = BAND_EDGES.find(([, lo, hi]) => f >= lo && f < hi);
      if (band) energy[band[0]] += mag[k] * mag[k];
    }
  });
  const total = Object.values(energy).reduce((a, b) => a + b, 0) || 1;
  const bands = Object.fromEntries(Object.entries(energy).map(([k, v]) => [k, Math.round((v / total) * 1000) / 10])) as MixStats['bands'];
  let corr: number | null = null;
  if (pcm.channels.length >= 2) {
    const [l, r] = pcm.channels;
    let lr = 0, ll = 0, rr = 0;
    for (let i = 0; i < l.length; i += 4) { lr += l[i] * r[i]; ll += l[i] * l[i]; rr += r[i] * r[i]; }
    corr = ll && rr ? Math.round((lr / Math.sqrt(ll * rr)) * 100) / 100 : null;
  }
  return {
    peakDb: db(peak),
    rmsDb: db(rms),
    crestDb: Math.round((db(peak) - db(rms)) * 10) / 10,
    bands,
    stereoCorrelation: corr,
    silence: Math.round((silent / Math.max(1, Math.floor(mono.length / block))) * 100) / 100,
    durationSec: Math.round((mono.length / sr) * 100) / 100,
  };
}

export function describeStats(s: MixStats): string {
  const b = s.bands;
  return [
    `peak ${s.peakDb} dBFS, RMS ${s.rmsDb} dBFS, crest ${s.crestDb} dB`,
    `spectrum: sub ${b.sub}% · low ${b.low}% · low-mid ${b.lowMid}% · mid ${b.mid}% · presence ${b.presence}% · air ${b.air}%`,
    s.stereoCorrelation !== null ? `stereo correlation ${s.stereoCorrelation}` : 'mono',
    s.silence > 0.05 ? `${Math.round(s.silence * 100)}% silence` : '',
  ].filter(Boolean).join('; ');
}

/** Peak envelope for waveform drawing. */
export function waveformPeaks(buf: { getChannelData(c: number): Float32Array; numberOfChannels: number; length: number }, buckets: number): Float32Array {
  const out = new Float32Array(buckets);
  const step = buf.length / buckets;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let b = 0; b < buckets; b++) {
      let m = 0;
      const s = Math.floor(b * step), e = Math.min(buf.length, Math.floor((b + 1) * step));
      for (let i = s; i < e; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
      if (m > out[b]) out[b] = m;
    }
  }
  return out;
}
