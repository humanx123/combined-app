import * as Tone from 'tone';
import { EngineGraph, preloadProject } from '../../src/engine/graph';
import { contextLock } from '../../src/engine/lock';
import { renderProject, exportAudio } from '../../src/engine/render';
import { createProject, createTrack, createMidiClip, beatsToSeconds } from '../../src/model/project';
import { initLibrary } from '../../src/samples/library';
import { mixStats, estimatePitch } from '../../src/samples/analysis';
import type { Project } from '../../src/model/types';
import type { PcmData } from '../../src/engine/wav';

const output = document.querySelector<HTMLPreElement>('#result')!;
const button = document.querySelector<HTMLButtonElement>('#run')!;
const write = (s: string) => { output.textContent += s + '\n'; };

function fixture(preset: string): Project {
  const p = createProject(`Regression: ${preset}`);
  p.bpm = 120;
  p.master.effects = [];
  const t = createTrack(p, preset === 'drums' ? 'drums' : 'instrument', { preset });
  t.volumeDb = -12;
  const c = createMidiClip(p, 0, 8);
  c.notes = [0, 1, 2, 3, 4, 5, 6, 7].map((start, i) => ({ id: String(i), start, pitch: preset === 'drums' ? t.drumLanes![i % 3].note : 60 + i % 3 * 2, duration: 0.8, velocity: 0.8 }));
  if (preset === 'bass808') c.notes.forEach((n) => { n.pitch -= 24; n.duration = 1.2; });
  t.clips.push(c);
  p.tracks.push(t);
  return p;
}

async function reference(p: Project): Promise<PcmData> {
  const assets = await preloadProject(p);
  return contextLock.run(async () => {
    let graph: EngineGraph | undefined;
    const old = Tone.getContext();
    try {
      const b = await Tone.Offline(async (ctx) => {
        graph = new EngineGraph({ live: false });
        await graph.sync(p, assets);
        ctx.transport.start(0);
      }, 5, 2, 44100);
      return { sampleRate: 44100, channels: b.toArray() as Float32Array[] };
    } finally { graph?.dispose(); Tone.setContext(old); }
  });
}

async function realtime(p: Project): Promise<PcmData> {
  const assets = await preloadProject(p);
  const native = new AudioContext({ sampleRate: 44100 });
  const ctx = new Tone.Context({ context: native as never, lookAhead: 0.1 });
  await native.audioWorklet.addModule(new URL('./capture.worklet.js', import.meta.url));
  const capture = new AudioWorkletNode(native, 'capture', { channelCount: 2 });
  capture.connect(native.destination); // Worklet output is silence; no speaker playback.
  const channels = [new Float32Array(220500), new Float32Array(220500)];
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
      const graph = new EngineGraph({ live: true });
      await graph.sync(p, assets);
      ctx.destination.disconnect();
      ctx.destination.connect(capture);
      return graph;
    } finally { Tone.setContext(old); }
  });
  try {
    await native.resume();
    startFrame = Math.ceil((native.currentTime + 0.3) * 44100 / 128) * 128;
    ctx.transport.start(startFrame / 44100);
    await new Promise((r) => setTimeout(r, 5500));
    return { sampleRate: 44100, channels };
  } finally { graph.dispose(); ctx.dispose(); capture.disconnect(); }
}

function error(a: PcmData, b: PcmData) {
  let diff = 0, energy = 0;
  for (let c = 0; c < a.channels.length; c++) for (let i = 0; i < Math.min(a.channels[c].length, b.channels[c].length); i++) {
    diff += (a.channels[c][i] - b.channels[c][i]) ** 2;
    energy += a.channels[c][i] ** 2;
  }
  return Math.sqrt(diff / Math.max(1e-20, energy));
}

function pitches(pcm: PcmData, bass = false) {
  return Array.from({ length: 8 }, (_, i) => estimatePitch({ sampleRate: pcm.sampleRate, channels: [pcm.channels[0].slice(Math.round((i * 0.5 + 0.1) * pcm.sampleRate), Math.round((i * 0.5 + 0.35) * pcm.sampleRate))] })?.note ?? '?').join(', ') + (bass ? ' (bass)' : '');
}

function levels(pcm: PcmData) {
  return Array.from({ length: 8 }, (_, i) => {
    const data = pcm.channels[0].subarray(i * 22050 + 4410, i * 22050 + 15000);
    return (10 * Math.log10(data.reduce((s, v) => s + v * v, 0) / data.length + 1e-20)).toFixed(1);
  }).join(', ');
}

button.onclick = async () => {
  button.disabled = true;
  output.textContent = '';
  try {
    await initLibrary();
    for (const preset of ['sub_bass', 'epiano', 'supersaw', 'bass808', 'drums', 'piano', 'electric_guitar']) {
      write(`Checking ${preset}…`);
      const p = fixture(preset);
      const expected = await reference(p);
      const direct = await renderProject(p, { endBeat: 8, tail: 1, stems: false, sampleRate: 44100 });
      const stems = await renderProject(p, { endBeat: 8, tail: 1, sampleRate: 44100 });
      const e1 = error(expected, direct), e2 = error(expected, stems);
      const stats = mixStats(direct);
      write(`Pitch export: ${pitches(direct)}; reference: ${pitches(expected)}`);
      write(`Levels export: ${levels(direct)}; reference: ${levels(expected)}`);
      const samePitch = pitches(direct) === pitches(expected);
      const sameLevel = Math.abs(stats.rmsDb - mixStats(expected).rmsDb) < 0.5;
      write(`${samePitch && sameLevel && error(direct, stems) < 0.0001 ? 'PASS' : 'FAIL'} ${preset}: note/level parity, direct-vs-stem error ${error(direct, stems).toFixed(6)}; reference waveform error ${e1.toFixed(6)} (phase-sensitive)`);
      const first = { sampleRate: 44100, channels: [direct.channels[0].slice(4410, 15000)] };
      if (preset === 'bass808') write(`808 first-note pitch: ${estimatePitch(first)?.note ?? 'undetected'} (expected C2)`);
      if (['sub_bass', 'epiano', 'bass808'].includes(preset)) {
        const live = await realtime(p);
        write(`Pitch live: ${pitches(live)}; levels live: ${levels(live)}`);
        write(`LIVE ${preset}: export error ${error(live, direct).toFixed(6)}; live RMS ${mixStats(live).rmsDb.toFixed(2)}dB; reference RMS ${mixStats(expected).rmsDb.toFixed(2)}dB`);
      }
    }
    const p = fixture('epiano');
    p.tracks[0].effects = [{ id: 'delay', type: 'delay', enabled: true, params: { time: '8n', feedback: 0.4, wet: 0.5, pingPong: 0 } }];
    const a = await reference(p);
    const b = await renderProject(p, { endBeat: 8, tail: 1, sampleRate: 44100 });
    write(`${Math.abs(mixStats(a).rmsDb - mixStats(b).rmsDb) < 0.5 ? 'PASS' : 'FAIL'} delay effect level parity; phase-sensitive waveform error: ${error(a, b).toFixed(6)}`);
    p.tracks[0].effects = [{ id: 'r', type: 'reverb', enabled: true, params: { decay: 2.5, preDelay: 0.02, wet: 0.4 } }];
    const r1 = await renderProject(p, { endBeat: 8, tail: 3 });
    const r2 = await renderProject(p, { endBeat: 8, tail: 3 });
    write(`${error(r1, r2) < 0.0001 ? 'PASS' : 'FAIL'} repeat reverb render: ${error(r1, r2).toFixed(6)}`);
    const wav = await exportAudio(p, 'wav24');
    const mp3 = await exportAudio(p, 'mp3');
    const ctx = new OfflineAudioContext(2, 1, 44100);
    const decodedWav = await ctx.decodeAudioData(await wav.arrayBuffer());
    const decodedMp3 = await ctx.decodeAudioData(await mp3.arrayBuffer());
    write(`PASS encoders: WAV ${decodedWav.duration.toFixed(2)}s; MP3 ${decodedMp3.duration.toFixed(2)}s; note ${beatsToSeconds(p, 1).toFixed(2)}s/beat`);
    write('DONE');
  } catch (e) { write(`ERROR: ${e instanceof Error ? e.stack : String(e)}`); }
  finally { button.disabled = false; }
};
