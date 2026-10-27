// Procedural sound design. Every built-in drum sound is synthesized here at startup,
// so the app ships a full, royalty-free kit with zero downloads - and the agent can
// design new one-shots (a longer 808, a crunchier snare) through the same functions.

import { withRenderSlot } from '../engine/renderQueue';

export const SR = 44100;

type Ctx = OfflineAudioContext;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseBuffer(ctx: Ctx, seconds: number, seed = 7): AudioBuffer {
  const len = Math.max(1, Math.floor(seconds * ctx.sampleRate));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const rnd = mulberry32(seed);
  for (let i = 0; i < len; i++) d[i] = rnd() * 2 - 1;
  return buf;
}

function noise(ctx: Ctx, seconds: number, seed?: number): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, seconds, seed);
  return src;
}

function shaper(ctx: Ctx, amount: number): WaveShaperNode {
  const ws = ctx.createWaveShaper();
  const k = amount * 60 + 0.001;
  const n = 2048;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
  }
  ws.curve = curve;
  ws.oversample = '4x';
  return ws;
}

function env(param: AudioParam, t0: number, peak: number, attack: number, decay: number, floor = 0.0001) {
  param.setValueAtTime(floor, t0);
  param.linearRampToValueAtTime(peak, t0 + Math.max(0.0005, attack));
  param.exponentialRampToValueAtTime(Math.max(floor, 0.0001), t0 + attack + Math.max(0.005, decay));
}

function render(seconds: number, build: (ctx: Ctx, out: AudioNode) => void, channels = 1): Promise<AudioBuffer> {
  // Startup requests the entire kit together. Share the native rendering budget
  // with exports/freezes instead of allocating 32 contexts at once on a phone.
  return withRenderSlot(async () => {
    const ctx = new OfflineAudioContext(channels, Math.ceil(seconds * SR), SR);
    const out = ctx.createGain();
    out.connect(ctx.destination);
    build(ctx, out);
    const buf = await ctx.startRendering();
    return normalize(buf, 0.89);
  });
}

export function normalize(buf: AudioBuffer, target = 0.89): AudioBuffer {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak > 0) {
    const g = target / peak;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= g;
    }
  }
  return buf;
}

// ------------------------------------------------------------------ kick

export interface KickParams {
  pitchStart?: number; // Hz
  pitchEnd?: number; // Hz
  pitchDecay?: number; // s
  decay?: number; // s
  click?: number; // 0..1
  drive?: number; // 0..1
}

export function kick(p: KickParams = {}): Promise<AudioBuffer> {
  const { pitchStart = 160, pitchEnd = 48, pitchDecay = 0.055, decay = 0.42, click = 0.5, drive = 0.2 } = p;
  return render(decay + 0.15, (ctx, out) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(pitchStart, 0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, pitchEnd), pitchDecay);
    const g = ctx.createGain();
    env(g.gain, 0, 1, 0.001, decay);
    const ws = shaper(ctx, drive);
    osc.connect(g).connect(ws).connect(out);
    osc.start(0);
    osc.stop(decay + 0.15);
    if (click > 0) {
      const n = noise(ctx, 0.02, 11);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const cg = ctx.createGain();
      env(cg.gain, 0, click * 0.6, 0.0005, 0.012);
      n.connect(hp).connect(cg).connect(out);
      n.start(0);
    }
  });
}

// ------------------------------------------------------------------ 808

export interface Bass808Params {
  /** MIDI note of the fundamental. Default 36 (C2 = 65.4Hz, sampler repitches). */
  note?: number;
  decay?: number;
  punch?: number; // pitch drop amount 0..1
  drive?: number; // 0..1
  click?: number;
}

export function bass808(p: Bass808Params = {}): Promise<AudioBuffer> {
  const { note = 36, decay = 1.8, punch = 0.6, drive = 0.3, click = 0.3 } = p;
  const f = 440 * Math.pow(2, (note - 69) / 12);
  return render(decay + 0.3, (ctx, out) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(f * (1 + punch * 2.5), 0);
    osc.frequency.exponentialRampToValueAtTime(f, 0.04 + punch * 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.linearRampToValueAtTime(1, 0.003);
    g.gain.setValueAtTime(1, 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, decay);
    const ws = shaper(ctx, drive * 0.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + drive * 3000;
    osc.connect(g).connect(ws).connect(lp).connect(out);
    osc.start(0);
    osc.stop(decay + 0.3);
    if (click > 0) {
      const k = ctx.createOscillator();
      k.frequency.setValueAtTime(f * 6, 0);
      k.frequency.exponentialRampToValueAtTime(f * 1.5, 0.02);
      const kg = ctx.createGain();
      env(kg.gain, 0, click * 0.5, 0.001, 0.03);
      k.connect(kg).connect(out);
      k.start(0);
      k.stop(0.06);
    }
  });
}

// ------------------------------------------------------------------ snare / clap

export interface SnareParams {
  tone?: number; // body Hz
  bodyDecay?: number;
  noiseDecay?: number;
  brightness?: number; // 0..1 (filter)
  snap?: number; // 0..1
  drive?: number;
}

export function snare(p: SnareParams = {}): Promise<AudioBuffer> {
  const { tone = 190, bodyDecay = 0.09, noiseDecay = 0.2, brightness = 0.6, snap = 0.6, drive = 0.15 } = p;
  const len = Math.max(bodyDecay, noiseDecay) + 0.1;
  return render(len, (ctx, out) => {
    const ws = shaper(ctx, drive);
    ws.connect(out);
    for (const [mult, amp] of [[1, 1], [1.62, 0.45]] as const) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(tone * mult * 1.4, 0);
      o.frequency.exponentialRampToValueAtTime(tone * mult, 0.02);
      const g = ctx.createGain();
      env(g.gain, 0, amp * 0.8, 0.001, bodyDecay);
      o.connect(g).connect(ws);
      o.start(0);
      o.stop(len);
    }
    const n = noise(ctx, len, 23);
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 1200 + brightness * 3000;
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 5000 + brightness * 3000;
    peak.gain.value = 6 * snap;
    const ng = ctx.createGain();
    env(ng.gain, 0, 0.9, 0.001, noiseDecay);
    n.connect(bp).connect(peak).connect(ng).connect(ws);
    n.start(0);
  });
}

export interface ClapParams {
  decay?: number;
  spread?: number; // s between bursts
  brightness?: number;
}

export function clap(p: ClapParams = {}): Promise<AudioBuffer> {
  const { decay = 0.22, spread = 0.011, brightness = 0.5 } = p;
  return render(decay + spread * 4 + 0.1, (ctx, out) => {
    const n = noise(ctx, decay + 0.2, 31);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1000 + brightness * 1500;
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    for (let i = 0; i < 3; i++) {
      const t = i * spread;
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.08, t + spread * 0.9);
    }
    const t3 = spread * 3;
    g.gain.setValueAtTime(1, t3);
    g.gain.exponentialRampToValueAtTime(0.0001, t3 + decay);
    n.connect(bp).connect(g).connect(out);
    n.start(0);
  });
}

// ------------------------------------------------------------------ hats & cymbals

export interface HatParams {
  decay?: number;
  brightness?: number;
  /** 0..1 mix of metallic oscillators vs noise */
  metal?: number;
}

const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

export function hat(p: HatParams = {}): Promise<AudioBuffer> {
  const { decay = 0.045, brightness = 0.7, metal = 0.6 } = p;
  return render(decay + 0.08, (ctx, out) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 9000 + brightness * 3000;
    bp.Q.value = 0.8;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000 + brightness * 2000;
    const g = ctx.createGain();
    env(g.gain, 0, 1, 0.0008, decay);
    bp.connect(hp).connect(g).connect(out);
    const base = 40;
    for (const r of HAT_RATIOS) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = base * r * 4;
      const og = ctx.createGain();
      og.gain.value = metal / HAT_RATIOS.length;
      o.connect(og).connect(bp);
      o.start(0);
      o.stop(decay + 0.08);
    }
    const n = noise(ctx, decay + 0.08, 41);
    const ng = ctx.createGain();
    ng.gain.value = 1 - metal * 0.6;
    n.connect(ng).connect(bp);
    n.start(0);
  });
}

export function cymbal(p: { decay?: number; brightness?: number } = {}): Promise<AudioBuffer> {
  const { decay = 1.6, brightness = 0.6 } = p;
  return render(decay + 0.2, (ctx, out) => {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 3500 + brightness * 2500;
    const g = ctx.createGain();
    env(g.gain, 0, 1, 0.002, decay);
    hp.connect(g).connect(out);
    for (const r of HAT_RATIOS) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 55 * r * 3.3;
      const og = ctx.createGain();
      og.gain.value = 0.08;
      o.connect(og).connect(hp);
      o.start(0);
      o.stop(decay + 0.2);
    }
    const n = noise(ctx, decay + 0.2, 53);
    const ng = ctx.createGain();
    ng.gain.value = 0.7;
    n.connect(ng).connect(hp);
    n.start(0);
  });
}

// ------------------------------------------------------------------ percussion

export function tonalPerc(p: { freq?: number; decay?: number; noise?: number; bend?: number } = {}): Promise<AudioBuffer> {
  const { freq = 400, decay = 0.12, noise: nz = 0.2, bend = 1.5 } = p;
  return render(decay + 0.1, (ctx, out) => {
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq * bend, 0);
    o.frequency.exponentialRampToValueAtTime(freq, 0.015);
    const g = ctx.createGain();
    env(g.gain, 0, 1, 0.0008, decay);
    o.connect(g).connect(out);
    o.start(0);
    o.stop(decay + 0.1);
    if (nz > 0) {
      const n = noise(ctx, 0.05, 61);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      const ng = ctx.createGain();
      env(ng.gain, 0, nz, 0.0005, 0.02);
      n.connect(hp).connect(ng).connect(out);
      n.start(0);
    }
  });
}

export function shaker(p: { decay?: number } = {}): Promise<AudioBuffer> {
  const { decay = 0.09 } = p;
  return render(decay + 0.08, (ctx, out) => {
    const n = noise(ctx, decay + 0.08, 71);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 7000;
    bp.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.linearRampToValueAtTime(1, decay * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, decay);
    n.connect(bp).connect(g).connect(out);
    n.start(0);
  });
}

// ------------------------------------------------------------------ fx & textures

export function riser(p: { seconds?: number } = {}): Promise<AudioBuffer> {
  const { seconds = 3.4 } = p;
  return render(seconds, (ctx, out) => {
    const n = noise(ctx, seconds, 83);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(300, 0);
    bp.frequency.exponentialRampToValueAtTime(9000, seconds);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, 0);
    g.gain.exponentialRampToValueAtTime(1, seconds * 0.97);
    g.gain.linearRampToValueAtTime(0, seconds);
    n.connect(bp).connect(g).connect(out);
    n.start(0);
  });
}

export function downlifter(p: { seconds?: number } = {}): Promise<AudioBuffer> {
  const { seconds = 2.5 } = p;
  return render(seconds, (ctx, out) => {
    const n = noise(ctx, seconds, 89);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(8000, 0);
    bp.frequency.exponentialRampToValueAtTime(200, seconds);
    const g = ctx.createGain();
    env(g.gain, 0, 1, 0.01, seconds);
    n.connect(bp).connect(g).connect(out);
    n.start(0);
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, 0);
    o.frequency.exponentialRampToValueAtTime(30, seconds * 0.8);
    const og = ctx.createGain();
    env(og.gain, 0, 0.8, 0.002, seconds * 0.7);
    o.connect(og).connect(out);
    o.start(0);
    o.stop(seconds);
  });
}

export function vinylCrackle(p: { seconds?: number; density?: number } = {}): Promise<AudioBuffer> {
  const { seconds = 8, density = 0.5 } = p;
  return render(seconds, (ctx, out) => {
    const len = Math.floor(seconds * ctx.sampleRate);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const rnd = mulberry32(97);
    for (let i = 0; i < len; i++) {
      d[i] = (rnd() * 2 - 1) * 0.04; // hiss bed
      if (rnd() < 0.0004 * density) {
        const amp = (rnd() * 0.8 + 0.2) * (rnd() < 0.5 ? -1 : 1);
        const l = Math.floor(rnd() * 30 + 4);
        for (let k = 0; k < l && i + k < len; k++) d[i + k] += amp * Math.exp(-k / 4);
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 6500;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 400;
    src.connect(hp).connect(lp).connect(out);
    src.start(0);
  });
}

export function impact(): Promise<AudioBuffer> {
  return render(3, (ctx, out) => {
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, 0);
    o.frequency.exponentialRampToValueAtTime(28, 1.2);
    const g = ctx.createGain();
    env(g.gain, 0, 1, 0.001, 2.2);
    o.connect(g).connect(shaper(ctx, 0.3)).connect(out);
    o.start(0);
    o.stop(3);
    const n = noise(ctx, 3, 101);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(8000, 0);
    lp.frequency.exponentialRampToValueAtTime(300, 2);
    const ng = ctx.createGain();
    env(ng.gain, 0, 0.5, 0.001, 2.5);
    n.connect(lp).connect(ng).connect(out);
    n.start(0);
  });
}

/** Reverse an AudioBuffer in place (new buffer). */
export function reverseBuffer(buf: AudioBuffer): AudioBuffer {
  const out = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    for (let i = 0, n = src.length; i < n; i++) dst[i] = src[n - 1 - i];
  }
  return out;
}

// ------------------------------------------------------------------ registry of designable sounds

export type DesignKind = 'kick' | '808' | 'snare' | 'clap' | 'hat' | 'openhat' | 'crash' | 'perc' | 'shaker' | 'riser' | 'downlifter' | 'impact' | 'vinyl';

export function design(kind: DesignKind, params: Record<string, number> = {}): Promise<AudioBuffer> {
  switch (kind) {
    case 'kick': return kick(params);
    case '808': return bass808(params);
    case 'snare': return snare(params);
    case 'clap': return clap(params);
    case 'hat': return hat(params);
    case 'openhat': return hat({ decay: 0.35, ...params });
    case 'crash': return cymbal(params);
    case 'perc': return tonalPerc(params);
    case 'shaker': return shaker(params);
    case 'riser': return riser(params);
    case 'downlifter': return downlifter(params);
    case 'impact': return impact();
    case 'vinyl': return vinylCrackle(params);
  }
}

export const DESIGN_PARAM_DOCS: Record<DesignKind, string> = {
  kick: 'pitchStart Hz (160), pitchEnd Hz (48), pitchDecay s (0.055), decay s (0.42), click 0-1, drive 0-1',
  '808': 'note MIDI root (36), decay s (1.8), punch 0-1 (pitch drop), drive 0-1, click 0-1',
  snare: 'tone Hz (190), bodyDecay s, noiseDecay s (0.2), brightness 0-1, snap 0-1, drive 0-1',
  clap: 'decay s (0.22), spread s (0.011), brightness 0-1',
  hat: 'decay s (0.045), brightness 0-1, metal 0-1',
  openhat: 'decay s (0.35), brightness 0-1, metal 0-1',
  crash: 'decay s (1.6), brightness 0-1',
  perc: 'freq Hz (400), decay s (0.12), noise 0-1, bend (1.5)',
  shaker: 'decay s (0.09)',
  riser: 'seconds (3.4)',
  downlifter: 'seconds (2.5)',
  impact: '(no params)',
  vinyl: 'seconds (8), density 0-1',
};
