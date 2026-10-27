import * as Tone from 'tone';
import { EngineGraph, preloadProject } from '../../src/engine/graph';
import { contextLock } from '../../src/engine/lock';
import { configureFreeze, frozenFor, scheduleFreeze } from '../../src/engine/freeze';
import { renderProject } from '../../src/engine/render';
import { createMidiClip, createProject, createTrack, beatsToSeconds } from '../../src/model/project';
import { initLibrary } from '../../src/samples/library';
import type { Project } from '../../src/model/types';
import type { PcmData } from '../../src/engine/wav';

// A realistic multi-track project (drums + synths + FX + master limiter), played on a
// realtime context and captured, then compared against exports of the same project.
const output = document.querySelector<HTMLPreElement>('#result')!;
const button = document.querySelector<HTMLButtonElement>('#run')!;
const write = (s: string) => { output.textContent += s + '\n'; };
const LIVE_RATE = Number(new URLSearchParams(location.search).get('rate') ?? 48000);
const BEATS = 16;

function fixture(): Project {
  const p = createProject('Export parity');
  p.bpm = 140;
  const drums = createTrack(p, 'drums');
  const lane = (n: string) => drums.drumLanes!.find((l) => l.name === n)!.note;
  const dc = createMidiClip(p, 0, BEATS);
  let id = 0;
  for (let b = 0; b < BEATS; b++) {
    dc.notes.push({ id: String(id++), start: b, duration: 0.25, pitch: lane(b % 2 ? 'snare' : 'kick'), velocity: 0.9 });
    for (let s = 0; s < 4; s++) dc.notes.push({ id: String(id++), start: b + s / 4, duration: 0.25, pitch: lane(s === 2 && b % 4 === 3 ? 'openhat' : 'hat'), velocity: 0.5 + 0.2 * (s % 2) });
  }
  drums.clips.push(dc);
  drums.effects = [{ id: 'dcomp', type: 'compressor', enabled: true, params: { threshold: -18, ratio: 4, attack: 0.01, release: 0.15, makeup: 3 } }];
  p.tracks.push(drums);
  const synth = (preset: string, notes: Array<[number, number, number]>, fx: Project['tracks'][0]['effects'] = []) => {
    const t = createTrack(p, 'instrument', { preset });
    const c = createMidiClip(p, 0, BEATS);
    c.notes = notes.map(([start, duration, pitch], i) => ({ id: String(i), start, duration, pitch, velocity: 0.8 }));
    t.clips.push(c);
    t.effects = fx;
    p.tracks.push(t);
  };
  const chords: Array<[number, number, number]> = [];
  for (let bar = 0; bar < BEATS / 4; bar++) for (const n of [[60, 63, 67], [58, 62, 65], [56, 60, 63], [55, 58, 62]][bar % 4]) chords.push([bar * 4, 3.5, n]);
  synth('supersaw', chords, [{ id: 'sr', type: 'reverb', enabled: true, params: { decay: 2.5, preDelay: 0.02, wet: 0.3 } }]);
  synth('pluck', Array.from({ length: BEATS * 2 }, (_, i) => [i / 2, 0.4, 72 + [0, 3, 7, 10, 12, 10, 7, 3][i % 8]] as [number, number, number]), [{ id: 'pd', type: 'delay', enabled: true, params: { time: '8n.', feedback: 0.35, wet: 0.25, pingPong: 1 } }]);
  synth('bass808', Array.from({ length: BEATS / 2 }, (_, i) => [i * 2, 1.5, 36 + [0, 0, 3, -2][i % 4]] as [number, number, number]));
  synth('pad', chords.map(([s, d, n]) => [s, d, n - 12] as [number, number, number]));
  return p;
}

async function live(p: Project, seconds: number): Promise<PcmData> {
  const assets = await preloadProject(p);
  const native = new AudioContext({ sampleRate: LIVE_RATE });
  const ctx = new Tone.Context({ context: native as never, lookAhead: 0.1 });
  await native.audioWorklet.addModule(new URL('./capture.worklet.js', import.meta.url));
  const capture = new AudioWorkletNode(native, 'capture', { channelCount: 2 });
  capture.connect(native.destination);
  const frames = Math.ceil(seconds * LIVE_RATE);
  const channels = [new Float32Array(frames), new Float32Array(frames)];
  let startFrame = Infinity;
  capture.port.onmessage = (e) => {
    const offset = e.data.frame - startFrame;
    for (let c = 0; c < 2; c++) {
      const src = e.data.channels[c] ?? e.data.channels[0];
      const from = Math.max(0, -offset), to = Math.min(src.length, channels[c].length - offset);
      if (to > from) channels[c].set(src.subarray(from, to), Math.max(0, offset));
    }
  };
  const graph = await contextLock.run(async () => {
    const old = Tone.getContext();
    Tone.setContext(ctx);
    try {
      const g = new EngineGraph({ live: true });
      await g.sync(p, assets);
      ctx.destination.disconnect();
      ctx.destination.connect(capture);
      return g;
    } finally { Tone.setContext(old); }
  });
  try {
    await native.resume();
    startFrame = Math.ceil((native.currentTime + 0.3) * LIVE_RATE / 128) * 128;
    ctx.transport.start(startFrame / LIVE_RATE);
    await new Promise((r) => setTimeout(r, (seconds + 0.6) * 1000));
    return { sampleRate: LIVE_RATE, channels };
  } finally { graph.dispose(); ctx.dispose(); capture.disconnect(); }
}

// Band energies via a naive DFT over frames: sample-rate independent comparison.
function bands(pcm: PcmData, from: number, to: number): number[] {
  const edges = [20, 150, 600, 2500, 6000, 12000, 20000];
  const n = 4096;
  const acc = new Array(edges.length - 1).fill(0);
  const re = new Float64Array(n), im = new Float64Array(n);
  const a = Math.round(from * pcm.sampleRate), b = Math.round(to * pcm.sampleRate);
  let count = 0;
  for (let s = a; s + n <= b; s += n / 2) {
    for (let i = 0; i < n; i++) { re[i] = pcm.channels[0][s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)); im[i] = 0; }
    fft(re, im);
    for (let k = 1; k < n / 2; k++) {
      const f = k * pcm.sampleRate / n;
      const band = edges.findIndex((e, j) => j < edges.length - 1 && f >= e && f < edges[j + 1]);
      if (band >= 0) acc[band] += re[k] * re[k] + im[k] * im[k];
    }
    count++;
  }
  // Normalize per frame and per bin width so different rates compare.
  return acc.map((v) => 10 * Math.log10(v / Math.max(1, count) + 1e-20));
}

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
      const xr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, xi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
      re[i + k + len / 2] = re[i + k] - xr; im[i + k + len / 2] = im[i + k] - xi;
      re[i + k] += xr; im[i + k] += xi;
    }
  }
}

function rmsDb(pcm: PcmData, from: number, to: number) {
  const d = pcm.channels[0].subarray(Math.round(from * pcm.sampleRate), Math.round(to * pcm.sampleRate));
  return 10 * Math.log10(d.reduce((s, v) => s + v * v, 0) / d.length + 1e-20);
}

function waveError(a: PcmData, b: PcmData, seconds: number) {
  if (a.sampleRate !== b.sampleRate) return NaN;
  let diff = 0, energy = 0;
  const n = Math.round(seconds * a.sampleRate);
  for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) { diff += (a.channels[c][i] - b.channels[c][i]) ** 2; energy += a.channels[c][i] ** 2; }
  return Math.sqrt(diff / Math.max(1e-20, energy));
}

function report(name: string, ref: PcmData, pcm: PcmData, seconds: number, maxBandDb: number, maxWaveError = Infinity) {
  const bl = bands(ref, 0, seconds), bx = bands(pcm, 0, seconds);
  const worst = Math.max(...bl.map((v, i) => Math.abs(v - bx[i])));
  const wave = waveError(ref, pcm, seconds);
  const pass = worst <= maxBandDb && !(wave > maxWaveError);
  write(`${pass ? 'PASS' : 'FAIL'} ${name} @${pcm.sampleRate} Hz: RMS ${rmsDb(pcm, 0, seconds).toFixed(2)} dB (playback ${rmsDb(ref, 0, seconds).toFixed(2)}); band deltas ${bx.map((v, i) => (v - bl[i]).toFixed(2)).join(' / ')} dB; waveform error ${wave.toFixed(4)}`);
}

button.onclick = async () => {
  button.disabled = true;
  output.textContent = '';
  try {
    await initLibrary();
    const p = fixture();
    const seconds = beatsToSeconds(p, BEATS);
    write(`Playback context ${LIVE_RATE} Hz; ${seconds.toFixed(2)} s; tracks ${p.tracks.map((t) => t.instrument?.preset ?? t.kind).join(', ')}`);
    // Exports default to the playback rate, as configured by the engine.
    configureFreeze(LIVE_RATE, () => {});
    // Before freezing: playback runs synths live. Oscillator phases differ between any
    // two playbacks (up to ~0.5 dB per band), but the export must not change the tone.
    const liveSynth = await live(p, seconds);
    report('export before freeze vs live synths', liveSynth, await renderProject(p, { endBeat: BEATS, reuseFrozen: false }), seconds, 1);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Freeze timed out')), 60000);
      configureFreeze(LIVE_RATE, () => { if (p.tracks.every((t) => frozenFor(p, t))) { clearTimeout(timeout); resolve(); } });
      scheduleFreeze(p);
    });
    // After freezing: playback streams frozen audio through the live mixer and master bus.
    const liveFrozen = await live(p, seconds);
    report('export vs frozen playback (master limiter)', liveFrozen, await renderProject(p, { endBeat: BEATS }), seconds, 0.05, 0.001);
    report('single-pass export vs frozen playback', liveFrozen, await renderProject(p, { endBeat: BEATS, stems: false }), seconds, 0.05, 0.001);
    write('DONE');
  } catch (e) { write(`ERROR: ${e instanceof Error ? e.stack : String(e)}`); }
  finally { button.disabled = false; }
};

