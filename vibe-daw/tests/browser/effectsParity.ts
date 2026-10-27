import * as Tone from 'tone';
import { EngineGraph, preloadProject } from '../../src/engine/graph';
import { contextLock } from '../../src/engine/lock';
import { configureFreeze } from '../../src/engine/freeze';
import { renderProject } from '../../src/engine/render';
import { createMidiClip, createProject, createTrack, beatsToSeconds } from '../../src/model/project';
import { defaultEffectParams } from '../../src/model/catalog';
import { initLibrary } from '../../src/samples/library';
import type { Effect, EffectType, Project } from '../../src/model/types';
import type { PcmData } from '../../src/engine/wav';

// Every effect type, on a track and on the master bus: live playback (captured from a
// realtime context) vs export. Compares the loudness envelope in 16th-note slices,
// which is what tremolo, ducking, delay timing and LFO sweeps change.
const output = document.querySelector<HTMLPreElement>('#result')!;
const button = document.querySelector<HTMLButtonElement>('#run')!;
const write = (s: string) => { output.textContent += s + '\n'; };
const RATE = 48000;
const BEATS = 8;
const TYPES: EffectType[] = ['eq', 'filter', 'compressor', 'reverb', 'delay', 'distortion', 'saturation', 'bitcrusher', 'chorus', 'phaser', 'tremolo', 'widener', 'lofi', 'limiter', 'duck'];

function effect(type: EffectType, params: Record<string, number | string> = {}): Effect {
  const base = defaultEffectParams(type);
  if (type === 'tremolo') Object.assign(base, { depth: 0.9 });
  return { id: `fx-${type}`, type, enabled: true, params: { ...base, ...params } };
}

function fixture(bpm = 140): Project {
  const p = createProject('Effects parity');
  p.bpm = bpm;
  const drums = createTrack(p, 'drums');
  const lane = (n: string) => drums.drumLanes!.find((l) => l.name === n)!.note;
  const dc = createMidiClip(p, 0, BEATS);
  for (let b = 0; b < BEATS; b++) dc.notes.push({ id: `k${b}`, start: b, duration: 0.25, pitch: lane(b % 2 ? 'snare' : 'kick'), velocity: 0.9 });
  drums.clips.push(dc);
  p.tracks.push(drums);
  // Sample-based sources only: live and export are then bit-identical without effects,
  // so any difference below comes from the effect itself.
  const keys = createTrack(p, 'instrument', { preset: 'piano' });
  const kc = createMidiClip(p, 0, BEATS);
  kc.notes = [0, 4].flatMap((start) => [60, 63, 67].map((pitch, i) => ({ id: `c${start}${i}`, start, duration: 4, pitch, velocity: 0.8 })));
  kc.notes.push(...Array.from({ length: BEATS }, (_, i) => ({ id: `m${i}`, start: i + 0.5, duration: 0.2, pitch: 79, velocity: 0.9 })));
  keys.clips.push(kc);
  p.tracks.push(keys);
  return p;
}

async function live(p: Project, edits: Project[] = [], fromBeat = 0): Promise<PcmData> {
  const seconds = beatsToSeconds(p, BEATS - fromBeat) + 0.5;
  const native = new AudioContext({ sampleRate: RATE });
  const ctx = new Tone.Context({ context: native as never, lookAhead: 0.1 });
  await native.audioWorklet.addModule(new URL('./capture.worklet.js', import.meta.url));
  const capture = new AudioWorkletNode(native, 'capture', { channelCount: 2 });
  capture.connect(native.destination);
  const frames = Math.ceil(seconds * RATE);
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
  // Like the app: the graph is built once, then each edit syncs into the same graph.
  const graph = await contextLock.run(async () => {
    const old = Tone.getContext();
    Tone.setContext(ctx);
    try {
      const g = new EngineGraph({ live: true });
      for (const q of [...edits, p]) await g.sync(q, await preloadProject(q));
      ctx.destination.disconnect();
      ctx.destination.connect(capture);
      return g;
    } finally { Tone.setContext(old); }
  });
  try {
    await native.resume();
    await new Promise((r) => setTimeout(r, 300)); // the graph idles a moment, as in the app
    startFrame = Math.ceil((native.currentTime + 0.3) * RATE / 128) * 128;
    ctx.transport.start(startFrame / RATE, beatsToSeconds(p, fromBeat));
    await new Promise((r) => setTimeout(r, (seconds + 0.6) * 1000));
    return { sampleRate: RATE, channels };
  } finally { graph.dispose(); ctx.dispose(); capture.disconnect(); void native.close(); }
}

/** Per-16th RMS (dB) differences over audible slices: [median, max]. */
function envelope(a: PcmData, b: PcmData, p: Project): [number, number] {
  const slice = Math.round(beatsToSeconds(p, 0.25) * RATE);
  const n = Math.floor(beatsToSeconds(p, BEATS) * RATE / slice);
  const db = (x: PcmData, c: number, i: number) => {
    let s = 0;
    for (let j = i * slice; j < (i + 1) * slice; j++) s += x.channels[c][j] ** 2;
    return 10 * Math.log10(s / slice + 1e-20);
  };
  const d: number[] = [];
  for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) { const x = db(a, c, i), y = db(b, c, i); if (Math.max(x, y) > -60) d.push(Math.abs(x - y)); }
  d.sort((x, y) => x - y);
  return [d[Math.floor(d.length / 2)] ?? 0, d[d.length - 1] ?? 0];
}

function waveError(a: PcmData, b: PcmData) {
  let diff = 0, energy = 0;
  for (let c = 0; c < 2; c++) for (let i = 0; i < a.channels[c].length; i++) { diff += (a.channels[c][i] - b.channels[c][i]) ** 2; energy += a.channels[c][i] ** 2; }
  return Math.sqrt(diff / Math.max(1e-20, energy));
}

/**
 * 90th-percentile error over 50 ms windows. Headless realtime capture drops a block
 * now and then (a burst at a random spot, even with no effects); a real mismatch,
 * like an LFO out of phase, shows up in nearly every window.
 */
function typicalError(a: PcmData, b: PcmData) {
  const win = Math.round(0.05 * RATE);
  const errors: number[] = [];
  for (let s = 0; s + win <= a.channels[0].length; s += win) {
    let diff = 0, energy = 0;
    for (let c = 0; c < 2; c++) for (let i = s; i < s + win; i++) { diff += (a.channels[c][i] - b.channels[c][i]) ** 2; energy += a.channels[c][i] ** 2; }
    if (energy > 1e-6) errors.push(Math.sqrt(diff / energy));
  }
  errors.sort((x, y) => x - y);
  return errors[Math.floor(errors.length * 0.9)] ?? 0;
}

function side(x: PcmData) {
  let m = 0, s = 0;
  for (let i = 0; i < x.channels[0].length; i++) { m += (x.channels[0][i] + x.channels[1][i]) ** 2; s += (x.channels[0][i] - x.channels[1][i]) ** 2; }
  return 10 * Math.log10(s / (m + 1e-20) + 1e-20);
}

async function compare(name: string, p: Project, edits: Project[] = []) {
  const e = await renderProject(p, { endBeat: BEATS, sampleRate: RATE, reuseFrozen: false });
  const l = await live(p, edits);
  const err = waveError(l, e), typical = typicalError(l, e);
  const [med, max] = envelope(l, e, p);
  const sw = side(e) - side(l);
  const pass = typical < 0.01;
  write(`${pass ? 'PASS' : 'FAIL'} ${name}: typical error ${typical.toFixed(4)} (whole ${err.toFixed(4)}); 16th-note level diff median ${med.toFixed(2)} dB, max ${max.toFixed(2)} dB; stereo side ${sw >= 0 ? '+' : ''}${sw.toFixed(2)} dB`);
}

const withFxOn = (p: Project, where: 'track' | 'master', fx: Effect): Project => where === 'master'
  ? { ...p, master: { ...p.master, effects: [fx, ...p.master.effects] } }
  : { ...p, tracks: p.tracks.map((t, i) => i === 0 ? { ...t, effects: [fx] } : t) };

const withFx = (p: Project, where: 'track' | 'master', fx: Effect): Project => where === 'master'
  ? { ...p, master: { ...p.master, effects: [fx, ...p.master.effects] } }
  : { ...p, tracks: p.tracks.map((t, i) => i === 1 ? { ...t, effects: [fx.type === 'duck' ? { ...fx, params: { ...fx.params, source: p.tracks[0].id } } : fx] } : t) };

/** Phase (degrees) of an amplitude wobble at `hz`, relative to song time. */
function wobblePhase(x: PcmData, hz: number, songStart: number, from: number, to: number) {
  const win = Math.round(0.004 * x.sampleRate);
  let re = 0, im = 0;
  for (let i = Math.round(from * x.sampleRate); i + win < to * x.sampleRate; i += win) {
    let e = 0;
    for (let j = i; j < i + win; j++) e += x.channels[0][j] ** 2;
    const t = songStart + (i + win / 2) / x.sampleRate;
    re += Math.sqrt(e / win) * Math.cos(2 * Math.PI * hz * t);
    im += Math.sqrt(e / win) * Math.sin(2 * Math.PI * hz * t);
  }
  return (Math.atan2(im, re) * 180 / Math.PI + 360) % 360;
}

async function lfoPhases() {
  const hz = 3;
  for (const where of ['track', 'master'] as const) {
    const p = createProject('LFO phase');
    p.bpm = 140;
    p.master.effects = [];
    const t = createTrack(p, 'instrument', { preset: 'sub_bass' });
    const c = createMidiClip(p, 0, BEATS);
    c.notes = [{ id: 'n', start: 0, duration: BEATS, pitch: 48, velocity: 0.8 }];
    t.clips.push(c);
    p.tracks.push(t);
    const trem = effect('tremolo', { frequency: hz, depth: 1 });
    const q = withFxOn(p, where, trem);
    const off = beatsToSeconds(q, 4);
    const a = await live(q), b = await live(q, [], 4);
    const x = await renderProject(q, { endBeat: BEATS, sampleRate: RATE, reuseFrozen: false });
    const y = await renderProject(q, { startBeat: 4, endBeat: BEATS, sampleRate: RATE, reuseFrozen: false });
    const ph = [wobblePhase(a, hz, 0, off, off + 1), wobblePhase(b, hz, off, 0, 1), wobblePhase(x, hz, 0, off, off + 1), wobblePhase(y, hz, off, 0, 1)];
    const worst = Math.max(...ph.flatMap((v) => ph.map((w) => Math.abs(((v - w + 540) % 360) - 180))));
    if (where === 'master') {
      // Looping bar 1: every pass must wobble exactly like the first.
      const looped = { ...q, loop: { enabled: true, start: 0, end: 4 } };
      const l = await live(looped);
      const first = wobblePhase(l, hz, 0, 0.2, 1.2), second = wobblePhase(l, hz, -off, off + 0.2, off + 1.2);
      const d = Math.abs(((first - second + 540) % 360) - 180);
      write(`${d < 3 ? 'PASS' : 'FAIL'} tremolo on a loop: first pass ${first.toFixed(1)}°, second pass ${second.toFixed(1)}°`);
    }
    write(`${worst < 3 ? 'PASS' : 'FAIL'} tremolo on ${where}: wobble phase at bar 2 - live from 0 ${ph[0].toFixed(1)}°, live from bar 2 ${ph[1].toFixed(1)}°, export ${ph[2].toFixed(1)}°, export from bar 2 ${ph[3].toFixed(1)}° (spread ${worst.toFixed(1)}°)`);
  }
}

button.onclick = async () => {
  button.disabled = true;
  output.textContent = '';
  try {
    await initLibrary();
    configureFreeze(RATE, () => {});
    const only = new URLSearchParams(location.search).get('only');
    if (!only || only.includes('lfo')) await lfoPhases();
    const base = fixture();
    if (!only) await compare('baseline (no effects)', base);
    for (const type of TYPES) {
      if (only && !only.split(',').includes(type)) continue;
      await compare(`${type} on track`, withFx(base, 'track', effect(type)));
      if (type !== 'duck') await compare(`${type} on master`, withFx(base, 'master', effect(type)));
    }
    // Interactions: edits arrive while the app is open, so the live graph reuses units
    // and applies params through update() instead of building fresh like the export.
    if (!only || only.includes('edits')) {
      // Sidechain ducking when the kick track is silent in the mix: exports build it as
      // a ghost that only sends duck triggers.
      const ducked = withFx(base, 'track', effect('duck'));
      await compare('duck with muted source', { ...ducked, tracks: ducked.tracks.map((t, i) => i === 0 ? { ...t, mute: true } : t) });
      await compare('duck on soloed track', { ...ducked, tracks: ducked.tracks.map((t, i) => i === 1 ? { ...t, solo: true } : t) });
      // Like a real edit: only bpm changes; tracks and effect objects are shared.
      for (const where of ['master', 'track'] as const) {
        const after = withFx(base, where, effect('delay'));
        await compare(`delay on ${where}, only tempo changed after load`, after, [{ ...after, bpm: 100 }]);
      }
      for (const type of TYPES) {
        const changed = Object.fromEntries(Object.entries(defaultEffectParams(type)).map(([k, v]) => [k, typeof v === 'number' ? (k === 'source' ? v : v * 0.5 + (v === 0 ? 0.3 : 0)) : v]));
        const before = withFx(base, 'master', effect(type, changed));
        if (type !== 'duck') await compare(`${type} on master, params edited after load`, withFx(base, 'master', effect(type)), [before]);
      }
    }
    write('DONE');
  } catch (e) { write(`ERROR: ${e instanceof Error ? e.stack : String(e)}`); }
  finally { button.disabled = false; }
};


