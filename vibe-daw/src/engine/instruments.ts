import { VoicePool } from './voicePool';
import * as Tone from 'tone';
import { midiToFreq } from '../model/theory';
import type { InstrumentSpec } from '../model/types';
import { PRESET_BY_ID, defaultPresetParams } from '../model/catalog';
import { bass808 } from '../samples/synth';
import { loadMultisample, isMultisampled } from './multisamples';
import { lfoClock, type LfoClock } from './lfo';

// Every instrument exposes the same tiny interface so the scheduler doesn't care
// whether it's a streamed piano, an FM bell, or a sliding 808.

export interface Instrument {
  output: Tone.ToneAudioNode;
  trigger(midi: number, durationSec: number, time: number, velocity: number): void;
  releaseAll(time?: number): void;
  setParams(params: Record<string, number>): void;
  /** Built-in modulation (chorus, vibrato, tremolo) kept in phase with the song. */
  lfo?: LfoClock;
  dispose(): void;
}

/** Resources an instrument needs before it can be built synchronously (sample zones, 808 body). */
export interface InstrumentAssets {
  zones?: Record<string, AudioBuffer>;
  body808?: AudioBuffer;
}

const body808Cache = new Map<string, Promise<AudioBuffer>>();

export async function prepareInstrument(spec: InstrumentSpec): Promise<InstrumentAssets> {
  if (isMultisampled(spec.preset)) {
    try {
      return { zones: await loadMultisample(spec.preset) };
    } catch (e) {
      console.warn(e);
      return {}; // falls back to a synth voice below
    }
  }
  if (spec.preset === 'bass808') {
    const p = { ...defaultPresetParams('bass808'), ...spec.params };
    const key = `${p.decay}|${p.punch}|${p.drive}`;
    let body = body808Cache.get(key);
    if (!body) {
      body = bass808({ note: 36, decay: p.decay, punch: p.punch, drive: p.drive });
      if (body808Cache.size >= 32) body808Cache.delete(body808Cache.keys().next().value!);
      body808Cache.set(key, body);
      void body.catch(() => { if (body808Cache.get(key) === body) body808Cache.delete(key); });
    }
    return { body808: await body };
  }
  return {};
}

const vel = (v: number) => Math.max(0.02, Math.min(1, v));

// ------------------------------------------------------------------ sampled

function sampled(spec: InstrumentSpec, zones: Record<string, AudioBuffer>): Instrument {
  const p = { ...defaultPresetParams(spec.preset), ...spec.params };
  const out = new Tone.Gain(1);
  const tone = new Tone.Filter({ type: 'lowpass', frequency: 20000, rolloff: -12 });
  const sampler = new Tone.Sampler({ urls: zones, release: p.release ?? 1, attack: 0.002 });
  sampler.connect(tone);
  tone.connect(out);
  const apply = (params: Record<string, number>) => {
    if (params.release !== undefined) sampler.release = params.release;
    if (params.brightness !== undefined) tone.frequency.value = 1500 + params.brightness * 18500;
  };
  apply(p);
  return {
    output: out,
    trigger: (midi, dur, time, v) => sampler.triggerAttackRelease(midiToFreq(midi), Math.max(0.03, dur), time, vel(v)),
    releaseAll: (t) => sampler.releaseAll(t),
    setParams: apply,
    dispose: () => { sampler.dispose(); tone.dispose(); out.dispose(); },
  };
}

// ------------------------------------------------------------------ 808 with slides

function eight08(spec: InstrumentSpec, body: AudioBuffer): Instrument {
  let p = { ...defaultPresetParams('bass808'), ...spec.params };
  const out = new Tone.Gain(1);
  const ROOT = 36;
  const resources = new Set<{ dispose(): void }>();
  let active: { src: Tone.ToneBufferSource; gain: Tone.Gain; start: number; end: number; midi: number; remaining: number; rateFrom: number; rateTo: number; glide: number } | null = null;

  const trigger = (midi: number, dur: number, time: number, v: number) => {
    const rate = Math.pow(2, (midi - ROOT) / 12);
    if (active && Math.abs(active.start - time) < 1e-4 && active.midi === midi) return; // duplicate event
    // Overlapping notes slide (classic trap 808 glide) instead of retriggering.
    if (active) {
      const elapsed = Math.max(0, time - active.start);
      const g = Math.min(elapsed, active.glide);
      const k = active.glide > 0 ? Math.log(active.rateTo / active.rateFrom) / active.glide : 0;
      const consumed = Math.abs(k) > 1e-9 ? active.rateFrom * Math.expm1(k * g) / k : active.rateFrom * g;
      active.remaining -= consumed + Math.max(0, elapsed - active.glide) * active.rateTo;
    }
    if (active && active.remaining > 0.005 && active.end > time + 0.005 && p.glide > 0) {
      const currentRate = active.src.playbackRate.getValueAtTime(time);
      active.src.playbackRate.cancelScheduledValues(time);
      active.src.playbackRate.setValueAtTime(currentRate, time);
      active.src.playbackRate.exponentialRampToValueAtTime(rate, time + p.glide);
      active.end = time + dur;
      active.start = time;
      active.midi = midi;
      active.rateFrom = currentRate;
      active.rateTo = rate;
      active.glide = p.glide;
      active.gain.gain.cancelScheduledValues(time);
      active.gain.gain.setValueAtTime(active.gain.gain.getValueAtTime(time), time);
      active.gain.gain.linearRampToValueAtTime(vel(v), time + 0.01);
      active.gain.gain.setValueAtTime(vel(v), time + dur);
      active.gain.gain.linearRampToValueAtTime(0, time + dur + 0.05);
      active.src.stop(time + dur + 0.06);
      return;
    }
    if (active) {
      // Mono: choke the previous note quickly.
      const prev = active;
      prev.gain.gain.cancelScheduledValues(time);
      prev.gain.gain.setValueAtTime(prev.gain.gain.getValueAtTime(time), time);
      prev.gain.gain.linearRampToValueAtTime(0, time + 0.012);
      prev.src.stop(time + 0.02);
    }
    const context = out.context;
    // Start at the note's level (no automation at the onset): offline renders hand us
    // event times a hair behind the clock, and an onset ramp there could zero the note.
    const gain = new Tone.Gain({ gain: vel(v), context }).connect(out);
    const src = new Tone.ToneBufferSource({ url: body, playbackRate: rate, context }).connect(gain);
    gain.gain.setValueAtTime(vel(v), time + dur);
    gain.gain.linearRampToValueAtTime(0, time + dur + 0.05);
    src.start(time);
    src.stop(time + dur + 0.06);
    const voice = { src, gain, start: time, end: time + dur, midi, remaining: body.duration, rateFrom: rate, rateTo: rate, glide: 0 };
    resources.add(src); resources.add(gain);
    src.onended = () => {
      // Offline, Tone fires 'ended' on its own clock, which runs ahead of the audio
      // actually rendered; disposing then would cut the note. The render frees it.
      if (!context.isOffline) { gain.dispose(); src.dispose(); resources.delete(src); resources.delete(gain); }
      if (active === voice) active = null;
    };
    active = voice;
  };

  return {
    output: out,
    trigger,
    releaseAll: (t) => {
      if (!active) return;
      const time = t ?? out.context.now();
      active.gain.gain.cancelScheduledValues(time);
      active.gain.gain.linearRampToValueAtTime(0, time + 0.03);
      active.src.stop(time + 0.04);
      active = null;
    },
    setParams: (params) => { p = { ...p, ...params }; },
    dispose: () => { for (const resource of resources) resource.dispose(); resources.clear(); out.dispose(); },
  };
}

// ------------------------------------------------------------------ Karplus-Strong pluck pool

function pluckGuitar(spec: InstrumentSpec): Instrument {
  let p = { ...defaultPresetParams('pluck_guitar'), ...spec.params };
  const out = new Tone.Gain(1.4);
  const body = new Tone.Filter({ type: 'peaking', frequency: 220, Q: 1, gain: 4 }).connect(out);
  const voices = Array.from({ length: 8 }, () => new Tone.PluckSynth({ attackNoise: 1.2, dampening: p.dampening, resonance: p.resonance }).connect(body));
  let rr = 0;
  return {
    output: out,
    trigger: (midi, dur, time, v) => {
      const voice = voices[rr++ % voices.length];
      voice.triggerAttackRelease(midiToFreq(midi), Math.max(0.05, dur), time);
      void v;
    },
    releaseAll: () => {},
    setParams: (params) => {
      p = { ...p, ...params };
      for (const v of voices) { v.dampening = p.dampening; v.resonance = p.resonance; }
    },
    dispose: () => { voices.forEach((v) => v.dispose()); body.dispose(); out.dispose(); },
  };
}

// ------------------------------------------------------------------ synth presets

type PolyVoice = VoicePool<Tone.Synth> | VoicePool<Tone.FMSynth> | VoicePool<Tone.MonoSynth> | VoicePool<Tone.AMSynth>;

function poly(voice: PolyVoice, chain: Tone.ToneAudioNode[], out: Tone.Gain, apply: (p: Record<string, number>) => void, params: Record<string, number>, extra: Array<{ dispose(): void }> = []): Instrument {
  voice.maxPolyphony = 24; // bounded pool steals release tails rather than dropping new notes
  let node: Tone.ToneAudioNode = voice;
  for (const c of chain) { node.connect(c); node = c; }
  node.connect(out);
  apply(params);
  return {
    output: out,
    trigger: (midi, dur, time, v) => voice.triggerAttackRelease(midiToFreq(midi), Math.max(0.02, dur), time, vel(v)),
    releaseAll: (t) => voice.releaseAll(t),
    setParams: apply,
    lfo: lfoClock(...chain.filter((c): c is Tone.Chorus | Tone.Tremolo | Tone.Vibrato => c instanceof Tone.Chorus || c instanceof Tone.Tremolo || c instanceof Tone.Vibrato)),
    dispose: () => { voice.dispose(); chain.forEach((c) => c.dispose()); extra.forEach((e) => e.dispose()); out.dispose(); },
  };
}

function synth(spec: InstrumentSpec): Instrument {
  const params = { ...defaultPresetParams(spec.preset), ...spec.params };
  const out = new Tone.Gain(1);
  switch (spec.preset) {
    case 'analog_brass': {
      const v = new VoicePool(Tone.MonoSynth, {
        oscillator: { type: 'sawtooth' }, filter: { type: 'lowpass', Q: 1.2, rolloff: -24 },
        envelope: { attack: 0.04, decay: 0.3, sustain: 0.65, release: 0.6 },
        filterEnvelope: { attack: 0.06, decay: 0.4, sustain: 0.3, release: 0.5, baseFrequency: 300, octaves: 2.5 },
      });
      out.gain.value = 0.35;
      return poly(v, [], out, (p) => v.set({ envelope: { attack: p.attack, release: p.release }, filter: { Q: p.resonance }, filterEnvelope: { baseFrequency: p.cutoff / 4, octaves: 2 } }), params);
    }
    case 'fm_bass':
    case 'marimba':
    case 'kalimba': {
      const bass = spec.preset === 'fm_bass', kalimba = spec.preset === 'kalimba';
      const v = new VoicePool(Tone.FMSynth, {
        harmonicity: bass ? 1 : kalimba ? 6.5 : 4,
        modulationIndex: params.bite,
        oscillator: { type: 'sine' }, modulation: { type: 'sine' },
        envelope: { attack: 0.002, decay: bass ? 0.4 : 0.7, sustain: bass ? 0.35 : 0, release: params.release },
        modulationEnvelope: { attack: 0.001, decay: bass ? 0.16 : 0.09, sustain: 0, release: 0.08 },
      });
      out.gain.value = bass ? 0.7 : 0.6;
      return poly(v, [], out, (p) => v.set({ modulationIndex: p.bite, envelope: { attack: p.attack ?? 0.002, release: p.release } }), params);
    }
    case 'chiptune': {
      const v = new VoicePool(Tone.Synth, { oscillator: { type: 'square' }, envelope: { attack: 0.002, decay: 0.1, sustain: 0.55, release: 0.12 } });
      const filter = new Tone.Filter({ type: 'lowpass', frequency: params.cutoff, rolloff: -12 });
      out.gain.value = 0.25;
      return poly(v, [filter], out, (p) => { filter.frequency.value = p.cutoff; v.set({ envelope: { attack: p.attack, release: p.release } }); }, params);
    }
    case 'glass_pad': {
      const v = new VoicePool(Tone.AMSynth, { harmonicity: params.shimmer, oscillator: { type: 'sine' }, modulation: { type: 'sine' }, envelope: { attack: 0.8, decay: 0.5, sustain: 0.8, release: 3 } });
      out.gain.value = 0.65;
      return poly(v, [], out, (p) => v.set({ harmonicity: p.shimmer, envelope: { attack: p.attack, release: p.release } }), params);
    }
    case 'epiano': {
      const v = new VoicePool(Tone.FMSynth, {
        harmonicity: 1,
        modulationIndex: 3,
        oscillator: { type: 'sine' },
        modulation: { type: 'sine' },
        envelope: { attack: 0.004, decay: 1.6, sustain: 0.25, release: 1 },
        modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0.05, release: 0.6 },
      });
      const trem = new Tone.Tremolo({ frequency: 4.2, depth: 0.15, spread: 90 }).start();
      out.gain.value = 0.9;
      return poly(v, [trem], out, (p) => {
        v.set({ envelope: { attack: p.attack, release: p.release }, modulationIndex: 1 + p.tine * 6 });
      }, params);
    }
    case 'sub_bass': {
      const v = new VoicePool(Tone.Synth, { oscillator: { type: 'sine' }, envelope: { attack: 0.005, decay: 0.1, sustain: 0.95, release: 0.2 } });
      out.gain.value = 1.2;
      return poly(v, [], out, (p) => v.set({ envelope: { attack: p.attack, release: p.release } }), params);
    }
    case 'reese': {
      const v = new VoicePool(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 2, spread: 36 }, envelope: { attack: 0.01, decay: 0.2, sustain: 0.9, release: 0.25 } });
      const f = new Tone.Filter({ type: 'lowpass', frequency: 900, Q: 1.5, rolloff: -24 });
      out.gain.value = 0.55;
      return poly(v, [f], out, (p) => { f.frequency.value = p.cutoff; v.set({ oscillator: { spread: p.detune * 2 } as never }); }, params);
    }
    case 'pad':
    case 'dark_pad': {
      const dark = spec.preset === 'dark_pad';
      const v = new VoicePool(Tone.Synth, {
        oscillator: { type: dark ? 'fattriangle' : 'fatsawtooth', count: 3, spread: dark ? 20 : 32 },
        envelope: { attack: 0.6, decay: 1, sustain: 0.85, release: 2.5 },
      });
      // Static cutoff on purpose: an audio-rate LFO on a biquad's frequency forces
      // per-sample coefficient math and made pads the slowest thing to bounce.
      // Movement comes from the chorus instead.
      const f = new Tone.Filter({ type: 'lowpass', frequency: 2200, Q: 0.7, rolloff: -12 });
      const chorus = new Tone.Chorus({ frequency: dark ? 0.15 : 0.4, delayTime: 4, depth: 0.7, wet: 0.4 }).start();
      out.gain.value = dark ? 0.6 : 0.45;
      return poly(v, [f, chorus], out, (p) => {
        f.frequency.value = p.cutoff;
        v.set({ envelope: { attack: p.attack, release: p.release } });
      }, params);
    }
    case 'strings': {
      const v = new VoicePool(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 3, spread: 26 }, envelope: { attack: 0.25, decay: 0.5, sustain: 0.85, release: 1.2 } });
      const f = new Tone.Filter({ type: 'lowpass', frequency: 3200, Q: 0.5, rolloff: -24 });
      const vib = new Tone.Vibrato({ frequency: 5, depth: 0.04 });
      out.gain.value = 0.35;
      return poly(v, [vib, f], out, (p) => v.set({ envelope: { attack: p.attack, release: p.release } }), params);
    }
    case 'choir': {
      const v = new VoicePool(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 2, spread: 18 }, envelope: { attack: 0.4, decay: 0.5, sustain: 0.9, release: 1.8 } });
      const f1 = new Tone.Filter({ type: 'bandpass', frequency: 750, Q: 4 });
      const f2 = new Tone.Filter({ type: 'bandpass', frequency: 1150, Q: 5 });
      const sum = new Tone.Gain(1.4);
      v.connect(f1);
      v.connect(f2);
      f1.connect(sum);
      f2.connect(sum);
      const vib = new Tone.Vibrato({ frequency: 4.5, depth: 0.06 });
      sum.connect(vib);
      vib.connect(out);
      const apply = (p: Record<string, number>) => v.set({ envelope: { attack: p.attack, release: p.release } });
      apply(params);
      v.maxPolyphony = 24;
      return {
        output: out,
        trigger: (midi, dur, time, ve) => v.triggerAttackRelease(midiToFreq(midi), Math.max(0.05, dur), time, vel(ve)),
        releaseAll: (t) => v.releaseAll(t),
        setParams: apply,
        lfo: lfoClock(vib),
        dispose: () => { v.dispose(); f1.dispose(); f2.dispose(); sum.dispose(); vib.dispose(); out.dispose(); },
      };
    }
    case 'bell':
    case 'music_box': {
      const box = spec.preset === 'music_box';
      const v = new VoicePool(Tone.FMSynth, {
        harmonicity: box ? 5.07 : 3.01,
        modulationIndex: box ? 3 : 12,
        oscillator: { type: 'sine' },
        modulation: { type: 'sine' },
        envelope: { attack: 0.001, decay: box ? 1.1 : 1.6, sustain: 0, release: 1.6 },
        modulationEnvelope: { attack: 0.001, decay: box ? 0.2 : 0.6, sustain: 0, release: 0.4 },
      });
      const hp = new Tone.Filter({ type: 'highpass', frequency: box ? 600 : 200 });
      out.gain.value = box ? 0.6 : 0.5;
      return poly(v, [hp], out, (p) => v.set({ envelope: { release: p.release }, ...(p.harmonicity ? { harmonicity: p.harmonicity } : {}) }), params);
    }
    case 'pluck': {
      const v = new VoicePool(Tone.MonoSynth, {
        oscillator: { type: 'sawtooth' },
        filter: { Q: 2, type: 'lowpass', rolloff: -24 },
        envelope: { attack: 0.002, decay: 0.35, sustain: 0, release: 0.2 },
        filterEnvelope: { attack: 0.001, decay: 0.2, sustain: 0, release: 0.2, baseFrequency: 300, octaves: 3.5 },
      });
      out.gain.value = 0.45;
      return poly(v, [], out, (p) => v.set({ envelope: { decay: p.decay }, filterEnvelope: { decay: p.decay * 0.7, octaves: Math.log2(Math.max(400, p.cutoff) / 300) } }), params);
    }
    case 'lead': {
      const v = new Tone.MonoSynth({
        oscillator: { type: 'fatsawtooth', count: 2, spread: 12 } as never,
        filter: { Q: 1, type: 'lowpass', rolloff: -24 },
        envelope: { attack: 0.005, decay: 0.2, sustain: 0.8, release: 0.3 },
        filterEnvelope: { attack: 0.005, decay: 0.3, sustain: 0.6, release: 0.3, baseFrequency: 600, octaves: 3 },
      });
      const vib = new Tone.Vibrato({ frequency: 5.5, depth: 0.05 });
      v.connect(vib);
      vib.connect(out);
      out.gain.value = 0.45;
      const apply = (p: Record<string, number>) => {
        v.portamento = p.glide;
        v.set({ envelope: { attack: p.attack, release: p.release }, filterEnvelope: { octaves: Math.log2(Math.max(700, p.cutoff) / 600) } });
      };
      apply(params);
      // Mono: notes that start together (a chord) collapse to the highest one.
      let lastStart = -1;
      let lastMidi = -1;
      return {
        output: out,
        trigger: (midi, dur, time, ve) => {
          if (Math.abs(time - lastStart) < 1e-4) {
            if (midi > lastMidi) { v.setNote(midiToFreq(midi), time); lastMidi = midi; }
            return;
          }
          lastStart = time;
          lastMidi = midi;
          v.triggerAttackRelease(midiToFreq(midi), Math.max(0.02, dur), time, vel(ve));
        },
        releaseAll: (t) => v.triggerRelease(t),
        setParams: apply,
        lfo: lfoClock(vib),
        dispose: () => { v.dispose(); vib.dispose(); out.dispose(); },
      };
    }
    case 'supersaw': {
      const v = new VoicePool(Tone.Synth, { oscillator: { type: 'fatsawtooth', count: 3, spread: 60 }, envelope: { attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.4 } });
      const f = new Tone.Filter({ type: 'lowpass', frequency: 6000, rolloff: -12 });
      out.gain.value = 0.22;
      return poly(v, [f], out, (p) => {
        f.frequency.value = p.cutoff;
        v.set({ envelope: { attack: p.attack, release: p.release }, oscillator: { spread: p.detune * 2 } as never });
      }, params);
    }
    default: {
      // Generic fallback (also used when a sampled instrument can't download).
      const v = new VoicePool(Tone.Synth, { oscillator: { type: 'triangle' }, envelope: { attack: 0.005, decay: 0.4, sustain: 0.4, release: 0.8 } });
      out.gain.value = 0.6;
      return poly(v, [], out, () => {}, params);
    }
  }
}

export function createInstrument(spec: InstrumentSpec, assets: InstrumentAssets): Instrument {
  if (!PRESET_BY_ID[spec.preset]) return synth({ preset: 'fallback', params: {} });
  if (spec.preset === 'bass808' && assets.body808) return eight08(spec, assets.body808);
  if (assets.zones && Object.keys(assets.zones).length) return sampled(spec, assets.zones);
  if (spec.preset === 'pluck_guitar' || spec.preset.includes('guitar')) return pluckGuitar(spec);
  return synth(spec);
}
