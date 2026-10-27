import * as Tone from 'tone';
import type { AudioClip, DrumLane, Effect, MidiClip, Project, Track } from '../model/types';
import { beatsToSeconds } from '../model/project';
import { getLoadedBuffer, getSampleMeta, loadBuffer } from '../samples/library';
import { prepareAudio, fadeEnvelope, type PreparedAudio } from './audio';
import { frozenFor, type Frozen } from './freeze';
import { createEffect, structuralParams, type EffectUnit } from './effects';
import { createInstrument, prepareInstrument, type Instrument, type InstrumentAssets } from './instruments';
import { trackTail } from './renderPlan';

// EngineGraph turns a Project into a live Tone.js graph and schedules it on a
// transport. The same class drives realtime playback and offline bounces, which is
// what lets the agent hear exactly what the user hears.

interface FxSlot { id: string; key: string; unit: EffectUnit; effect: Effect }

interface Strip {
  id: string;
  track: Track;
  instKey: string;
  instrument: Instrument | null;
  input: Tone.Gain;
  fx: FxSlot[];
  channel: Tone.Channel;
  liveGate: Tone.Gain;
  meter: Tone.Meter | null;
  events: number[];
  scheduledClips: Track['clips'] | null;
  scheduledLanes: DrumLane[] | undefined;
  chokes: Map<number, { src: Tone.ToneBufferSource; gain: Tone.Gain }>;
  audioVoices: Set<{ stop(time: number): void }>;
  audioBuffers: Map<string, PreparedAudio>;
  resources: Set<{ dispose(): void }>;
  /** Silent placeholder that only fires sidechain-duck triggers (offline stems). */
  ghost: boolean;
  /** Live only: pre-rendered audio of this track, played instead of its instrument + FX. */
  frozen: Frozen | null;
}

export interface GraphOptions {
  /** Live graphs get meters and a metronome. */
  live: boolean;
  /** If set, only these tracks are audible. */
  onlyTracks?: string[] | null;
  /** Offline stems: skip the master bus (it's applied once, after stems are summed). */
  bypassMaster?: boolean;
  /** Reuse the exact pre-fader audio already used by editor playback. */
  frozenTracks?: ReadonlyMap<string, Frozen>;
}

function safetyCurve(): Float32Array {
  const n = 4096;
  const knee = 0.79; // -2 dBFS
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // WaveShaper input is [-1, 1]; the signal arrives pre-scaled by 0.5, so this
    // covers true amplitudes up to ±2 (+6 dBFS) instead of hard-clamping at 0 dBFS.
    const x = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(x);
    const y = a <= knee ? a : knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee));
    c[i] = Math.sign(x) * Math.min(0.999, y);
  }
  return c;
}

function instKey(t: Track): string {
  if (t.kind !== 'instrument' || !t.instrument) return t.kind;
  const p = t.instrument.params;
  // 808 body is rendered from these params; everything else updates live.
  const extra = t.instrument.preset === 'bass808' ? `${p.decay}|${p.punch}|${p.drive}` : '';
  return `${t.instrument.preset}|${extra}`;
}

function fxKey(e: Effect): string {
  return `${e.id}|${e.type}|${structuralParams(e)}`;
}

/** Collect everything a project needs loaded before it can play. */
export async function preloadProject(p: Project): Promise<Map<string, InstrumentAssets>> {
  const assets = new Map<string, InstrumentAssets>();
  const sampleIds = new Set<string>();
  for (const t of p.tracks) {
    t.drumLanes?.forEach((l) => sampleIds.add(l.sampleId));
    t.clips.forEach((c) => { if (c.type === 'audio') sampleIds.add(c.sampleId); });
  }
  // Cloud clips and instrument zones can each take time to download. Start both
  // groups together so a project doesn't wait for one before requesting the other.
  await Promise.all([
    Promise.all(p.tracks.map(async (t) => {
      if (t.kind === 'instrument' && t.instrument) assets.set(t.id, await prepareInstrument(t.instrument));
    })),
    Promise.all([...sampleIds].map(async (id) => {
      if (!await loadBuffer(id)) throw new Error(`Audio file “${getSampleMeta(id)?.name ?? id}” is unavailable. Sync the song from the original computer, then try Play again.`);
    })),
  ]);
  for (const t of p.tracks) for (const c of t.clips) if (c.type === 'audio' && !c.muted) prepareAudio(c, p.bpm);
  return assets;
}

/** A hand-played chord rings until it is released or replaced; this only bounds a forgotten one. */
const LIVE_HOLD_SEC = 300;

export class EngineGraph {
  readonly transport: ReturnType<typeof Tone.getTransport>;
  readonly context: Tone.BaseContext;
  private strips = new Map<string, Strip>();
  private masterIn: Tone.Gain;
  private masterFx: FxSlot[] = [];
  private masterChannel: Tone.Channel;
  private safety: Tone.WaveShaper;
  private safetyPre: Tone.Gain;
  readonly masterMeter: Tone.Meter | null;
  readonly analyser: Tone.Analyser | null;
  private project: Project | null = null;
  private globalKey = '';
  private metronomeId: number | null = null;
  private clickBuffers: { hi: AudioBuffer; lo: AudioBuffer } | null = null;
  private disposed = false;
  private listeners: Array<[string, (...args: never[]) => void]> = [];
  private ducks = new Map<string, EffectUnit[]>();

  constructor(private opts: GraphOptions) {
    this.context = Tone.getContext();
    this.transport = Tone.getTransport();
    this.masterIn = new Tone.Gain(1);
    this.masterChannel = new Tone.Channel({ volume: 0, channelCount: 2 });
    this.masterMeter = opts.live ? new Tone.Meter({ smoothing: 0.8, channelCount: 2 }) : null;
    this.analyser = opts.live ? new Tone.Analyser('fft', 256) : null;
    // Final safety: transparent below -2 dBFS, soft-saturates above, never exceeds 0 dBFS.
    this.safety = new Tone.WaveShaper(safetyCurve(), 4096);
    this.safety.oversample = '2x';
    this.safetyPre = new Tone.Gain(0.5);
    if (opts.bypassMaster) {
      this.masterIn.connect(Tone.getDestination());
    } else {
      this.masterIn.connect(this.masterChannel);
      this.masterChannel.connect(this.safetyPre);
      this.safetyPre.connect(this.safety);
      this.safety.connect(Tone.getDestination());
    }
    if (this.masterMeter) this.masterChannel.connect(this.masterMeter);
    if (this.analyser) this.masterChannel.connect(this.analyser);

    const on = (ev: string, fn: (...args: never[]) => void) => {
      this.transport.on(ev as 'start', fn as never);
      this.listeners.push([ev, fn]);
    };
    on('start', ((time: number, offset: number) => this.chaseAudio(time, offset)) as never);
    on('loopStart', ((time: number, offset: number) => this.chaseAudio(time, offset)) as never);
    on('loopEnd', ((time: number) => this.stopVoices(time, true)) as never);
    on('stop', ((time: number) => this.stopVoices(time, true)) as never);
    on('pause', ((time: number) => this.stopVoices(time, true)) as never);
  }

  /** Where a pre-mixed signal can enter the master bus (used by the stem renderer). */
  get masterInput(): Tone.ToneAudioNode {
    return this.masterIn;
  }

  // ---------------------------------------------------------------- sync

  /** Bring the graph in line with the project. Only changed parts are rebuilt/rescheduled. */
  async sync(p: Project, preloaded?: Map<string, InstrumentAssets>, deferNewFreezes = false): Promise<void> {
    if (this.disposed) return;
    const prev = this.project;
    this.project = p;
    const t = this.transport;
    t.bpm.value = p.bpm;
    t.timeSignature = p.timeSignature[0] * (4 / p.timeSignature[1]);
    t.loop = p.loop.enabled;
    if (p.loop.end > p.loop.start) {
      t.loopStart = `${Math.round(p.loop.start * t.PPQ)}i`;
      t.loopEnd = `${Math.round(p.loop.end * t.PPQ)}i`;
    }
    // Tempo-synced params (delay times like '8n.') are converted to seconds when
    // applied, so a tempo change has to re-apply them even if the params didn't change.
    const tempoChanged = !!prev && prev.bpm !== p.bpm;
    if (!this.opts.bypassMaster) {
      this.masterChannel.volume.value = p.master.volumeDb;
      this.masterFx = await this.syncFx(this.masterFx, p.master.effects, this.masterIn, this.masterChannel, tempoChanged);
    }

    const gk = `${p.bpm}|${p.swing}|${p.timeSignature.join('/')}|${this.duckSignature(p)}`;
    const globalChanged = gk !== this.globalKey;
    this.globalKey = gk;

    const live = new Set(p.tracks.map((x) => x.id));
    for (const [id, s] of this.strips) if (!live.has(id)) this.disposeStrip(s);

    const anySolo = p.tracks.some((x) => x.solo);
    const audibleOf = (track: Track) => (this.opts.onlyTracks ? this.opts.onlyTracks.includes(track.id) : !track.mute && (!anySolo || track.solo));
    // Offline renders don't build silent tracks at all - except ones that trigger a
    // sidechain duck on an audible track; those become ghosts that only send triggers.
    const duckSources = new Set<string>();
    for (const t of p.tracks) if (audibleOf(t)) for (const e of t.effects) if (e.type === 'duck' && e.enabled) duckSources.add(String(e.params.source));
    for (const track of p.tracks) {
      const ghost = !this.opts.live && !audibleOf(track);
      if (ghost && !duckSources.has(track.id)) {
        const stale = this.strips.get(track.id);
        if (stale) this.disposeStrip(stale);
        continue;
      }
      let s = this.strips.get(track.id);
      if (!s) {
        const input = new Tone.Gain(1);
        const channel = new Tone.Channel({ volume: track.volumeDb, pan: track.pan, channelCount: 2 });
        const liveGate = new Tone.Gain(1).connect(channel);
        input.connect(liveGate); // empty FX chain; syncFx rewires when effects are added
        channel.connect(this.masterIn);
        const meter = this.opts.live ? new Tone.Meter({ smoothing: 0.75 }) : null;
        if (meter) channel.connect(meter);
        s = { id: track.id, track, instKey: '', instrument: null, input, fx: [], channel, liveGate, meter, events: [], scheduledClips: null, scheduledLanes: undefined, chokes: new Map(), audioVoices: new Set(), audioBuffers: new Map(), resources: new Set(), ghost, frozen: null };
        this.strips.set(track.id, s);
      }
      s.ghost = ghost;
      if (ghost) {
        s.channel.mute = true;
        s.track = track;
        await this.scheduleTrack(s);
        continue;
      }
      const frozen = this.opts.live && deferNewFreezes && !s.frozen ? null : this.opts.frozenTracks?.get(track.id) ?? (this.opts.live ? frozenFor(p, track) : null);
      const key = instKey(track);
      if (!frozen || this.opts.live) {
      if (key !== s.instKey) {
        s.instrument?.releaseAll();
        s.instrument?.dispose();
        s.instrument = null;
        if (track.kind === 'instrument' && track.instrument) {
          const assets = preloaded?.get(track.id) ?? (await prepareInstrument(track.instrument));
          if (this.disposed) return;
          s.instrument = createInstrument(track.instrument, assets);
          s.instrument.output.connect(s.input);
          this.alignIfPlaying(s.instrument);
        }
        s.instKey = key;
      } else if (track.instrument && s.track.instrument?.params !== track.instrument.params) {
        s.instrument?.setParams(track.instrument.params);
      }
      s.fx = await this.syncFx(s.fx, track.effects, s.input, s.liveGate, tempoChanged);
      }
      // Frozen audio enters the channel directly. Keep the live chain connected for
      // keyboard previews; its notes are not scheduled while the track is frozen.
      const frozenChanged = frozen !== s.frozen;
      s.frozen = frozen;
      if (frozenChanged) {
        const now = this.context.now();
        s.liveGate.gain.cancelScheduledValues(now);
        if (this.opts.live && this.transport.state === 'started' && frozen) {
          s.liveGate.gain.setValueAtTime(1, now + 0.05);
          s.liveGate.gain.linearRampToValueAtTime(0, now + 0.06);
        } else if (this.opts.live) s.liveGate.gain.rampTo(frozen ? 0 : 1, 0.01);
        else s.liveGate.gain.value = frozen ? 0 : 1;
      }
      if (this.opts.live && prev) {
        if (s.track.volumeDb !== track.volumeDb) s.channel.volume.rampTo(track.volumeDb, 0.02);
        if (s.track.pan !== track.pan) s.channel.pan.rampTo(track.pan, 0.02);
      } else {
        s.channel.volume.value = track.volumeDb;
        s.channel.pan.value = track.pan;
      }
      s.channel.mute = !audibleOf(track);
      const needsSchedule = frozenChanged || globalChanged || s.scheduledClips !== track.clips || s.scheduledLanes !== track.drumLanes || prev === null;
      s.track = track;
      if (needsSchedule) {
        await this.scheduleTrack(s);
        if (this.transport.state === 'started') this.rechase(s);
      }
    }
    this.ducks.clear();
    for (const s of this.strips.values()) for (const f of s.fx) if (f.unit.duck) {
      const source = String(f.effect.params.source);
      const targets = this.ducks.get(source) ?? [];
      targets.push(f.unit);
      this.ducks.set(source, targets);
    }
    if (!prev || prev.timeSignature !== p.timeSignature) this.syncMetronome();
  }

  private duckSignature(p: Project): string {
    const parts: string[] = [];
    for (const t of p.tracks) for (const e of t.effects) if (e.type === 'duck') parts.push(`${t.id}<${e.params.source}`);
    return parts.join(',');
  }

  private async syncFx(slots: FxSlot[], effects: Effect[], input: Tone.ToneAudioNode, output: Tone.ToneAudioNode, tempoChanged = false): Promise<FxSlot[]> {
    const enabled = effects.filter((e) => e.enabled);
    const sameChain = slots.length === enabled.length && slots.every((s, i) => s.key === fxKey(enabled[i]));
    if (sameChain) {
      slots.forEach((s, i) => {
        if (tempoChanged || s.effect.params !== enabled[i].params) s.unit.update(enabled[i].params);
        s.effect = enabled[i];
      });
      await Promise.all(slots.map((s) => s.unit.ready));
      return slots;
    }
    // Rebuild the chain, reusing units whose key is unchanged.
    const old = new Map(slots.map((s) => [s.key, s]));
    const next: FxSlot[] = [];
    for (const e of enabled) {
      const k = fxKey(e);
      const reuse = old.get(k);
      if (reuse) {
        old.delete(k);
        if (tempoChanged || reuse.effect.params !== e.params) reuse.unit.update(e.params);
        reuse.effect = e;
        next.push(reuse);
      } else {
        const unit = createEffect(e);
        this.alignIfPlaying(unit);
        next.push({ id: e.id, key: k, unit, effect: e });
      }
    }
    await Promise.all(next.map((s) => s.unit.ready));
    input.disconnect();
    for (const s of slots) s.unit.output.disconnect();
    for (const s of old.values()) s.unit.dispose();
    let node: Tone.ToneAudioNode = input;
    for (const s of next) { node.connect(s.unit.input); node = s.unit.output; }
    node.connect(output);
    return next;
  }

  // ---------------------------------------------------------------- scheduling

  /**
   * Schedule a transport callback that ignores duplicate firings at the same time
   * (Tone can re-fire an event on a clock-block boundary; a doubled note is louder).
   */
  private once(cb: (time: number) => void, at: string): number {
    let last = -Infinity;
    return this.transport.schedule((time) => {
      if (Math.abs(time - last) < 0.002) return;
      last = time;
      cb(time);
    }, at);
  }

  private ticks(beat: number): string {
    return `${Math.max(0, Math.round(beat * this.transport.PPQ))}i`;
  }

  private swingOffset(beat: number): number {
    const p = this.project!;
    if (!p.swing) return 0;
    const sixteenth = beat * 4;
    const isOff = Math.abs(sixteenth - Math.round(sixteenth)) < 0.02 && Math.round(sixteenth) % 2 === 1;
    return isOff ? p.swing * 0.25 * 0.66 : 0;
  }

  private async scheduleTrack(s: Strip) {
    for (const id of s.events) this.transport.clear(id);
    s.events = [];
    s.audioBuffers.clear();
    s.scheduledClips = s.track.clips;
    s.scheduledLanes = s.track.drumLanes;
    const p = this.project!;
    const track = s.track;
    if (s.frozen) {
      const f = s.frozen;
      s.events.push(this.once((time) => this.startFrozenVoice(s, time, 0), this.ticks(f.startBeat)));
      // Keep sending sidechain triggers to live tracks that duck from this one.
      const wasGhost = s.ghost;
      s.ghost = true;
      for (const clip of track.clips) if (!clip.muted && clip.type === 'midi') this.scheduleMidi(s, clip, p);
      s.ghost = wasGhost;
      return;
    }
    for (const clip of track.clips) {
      if (clip.muted) continue;
      if (clip.type === 'midi') this.scheduleMidi(s, clip, p);
      else if (!s.ghost) await this.scheduleAudio(s, clip);
    }
  }

  private duckTargets(sourceTrackId: string): EffectUnit[] {
    return this.ducks.get(sourceTrackId) ?? [];
  }

  private scheduleMidi(s: Strip, clip: MidiClip, p: Project) {
    const isDrums = s.track.kind === 'drums';
    const laneByNote = new Map((s.track.drumLanes ?? []).map((l) => [l.note, l]));
    for (const n of clip.notes) {
      if (n.start >= clip.length || n.start < 0) continue;
      const beat = clip.start + n.start + this.swingOffset(clip.start + n.start);
      const durBeats = Math.min(n.duration, clip.length - n.start);
      const durSec = beatsToSeconds(p, Math.max(0.01, durBeats));
      const trackId = s.track.id;
      if (s.ghost) {
        s.events.push(this.once((time) => { for (const d of this.duckTargets(trackId)) d.duck!(time); }, this.ticks(beat)));
        continue;
      }
      if (isDrums) {
        const lane = laneByNote.get(n.pitch);
        if (!lane) continue;
        const id = this.once((time) => {
          try {
            this.triggerDrum(s, lane, time, n.velocity);
            for (const d of this.duckTargets(trackId)) d.duck!(time);
          } catch (e) {
            console.warn('Drum hit failed', e); // never let one bad event stall the transport
          }
        }, this.ticks(beat));
        s.events.push(id);
      } else {
        const id = this.once((time) => {
          try {
            s.instrument?.trigger(n.pitch, durSec, time, n.velocity);
            for (const d of this.duckTargets(trackId)) d.duck!(time);
          } catch (e) {
            console.warn('Note failed', e); // never let one bad event stall the transport
          }
        }, this.ticks(beat));
        s.events.push(id);
      }
    }
  }

  triggerDrum(s: Strip | string, lane: DrumLane, time: number, velocity: number) {
    const strip = typeof s === 'string' ? this.strips.get(s) : s;
    if (!strip) return;
    const buf = getLoadedBuffer(lane.sampleId);
    if (!buf) return;
    if (lane.choke !== undefined) {
      const prev = strip.chokes.get(lane.choke);
      if (prev) {
        try {
          prev.gain.gain.cancelScheduledValues(time);
          prev.gain.gain.setValueAtTime(prev.gain.gain.getValueAtTime(time), time);
          prev.gain.gain.linearRampToValueAtTime(0, time + 0.015);
          prev.src.stop(time + 0.02);
        } catch { /* already stopped */ }
      }
    }
    const context = this.context;
    const gain = new Tone.Gain({ gain: Tone.dbToGain(lane.gainDb) * Math.max(0.05, velocity), context }).connect(strip.input);
    const src = new Tone.ToneBufferSource({ url: buf, playbackRate: Math.pow(2, lane.pitch / 12), context }).connect(gain);
    src.start(time);
    strip.resources.add(src);
    strip.resources.add(gain);
    const voice = { stop: (t: number) => {
      try {
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.getValueAtTime(t), t);
        gain.gain.linearRampToValueAtTime(0, t + 0.01);
        src.stop(t + 0.015);
      } catch { /* already stopped */ }
    } };
    strip.audioVoices.add(voice);
    src.onended = () => {
      strip.audioVoices.delete(voice);
      if (!context.isOffline) { src.dispose(); gain.dispose(); strip.resources.delete(src); strip.resources.delete(gain); }
      if (lane.choke !== undefined && strip.chokes.get(lane.choke)?.src === src) strip.chokes.delete(lane.choke);
    };
    if (lane.choke !== undefined) strip.chokes.set(lane.choke, { src, gain });
  }

  private async scheduleAudio(s: Strip, clip: AudioClip) {
    if (!getLoadedBuffer(clip.sampleId)) await loadBuffer(clip.sampleId);
    const audio = prepareAudio(clip, this.project!.bpm);
    if (!audio) return;
    s.audioBuffers.set(clip.id, audio);
    const id = this.once((time) => this.startAudioVoice(s, clip, time, 0), this.ticks(clip.start));
    s.events.push(id);
  }

  /** Start an audio clip voice at `time`, `elapsedBeats` into the clip. */
  private startAudioVoice(s: Strip, clip: AudioClip, time: number, elapsedBeats: number) {
    const p = this.project!;
    const audio = s.audioBuffers.get(clip.id);
    if (!audio || s.ghost) return;
    const { buffer: buf, rate, offsetScale } = audio;
    const elapsedSec = beatsToSeconds(p, elapsedBeats);
    let offset = clip.offset * offsetScale + elapsedSec * rate;
    // Loops cycle the whole sample; offset only sets where playback enters it.
    if (clip.loop && buf.duration > 0.01) offset = ((offset % buf.duration) + buf.duration) % buf.duration;
    if (!clip.loop && offset >= buf.duration) return;
    const remainingSec = Math.min(beatsToSeconds(p, clip.length - elapsedBeats), clip.loop ? Infinity : (buf.duration - offset) / rate);
    if (remainingSec <= 0.005) return;
    const context = this.context;
    const gain = new Tone.Gain({ gain: 0, context }).connect(s.input);
    const g = Tone.dbToGain(clip.gainDb);
    const envelope = fadeEnvelope(elapsedSec + remainingSec, clip.fadeIn, clip.fadeOut, elapsedSec);
    gain.gain.setValueAtTime(0, time);
    if (elapsedSec > 0) gain.gain.linearRampToValueAtTime(g * envelope.level, time + Math.min(0.002, remainingSec));
    if (envelope.attack > 0) gain.gain.linearRampToValueAtTime(g, time + Math.max(0.002, envelope.attack));
    const end = time + remainingSec;
    if (envelope.release > envelope.attack) gain.gain.setValueAtTime(g, time + envelope.release);
    gain.gain.linearRampToValueAtTime(0, end);

    const node = new Tone.ToneBufferSource({ context, url: buf, playbackRate: rate, loop: clip.loop, loopStart: 0, loopEnd: buf.duration });
    node.connect(gain);
    node.start(time, offset);
    node.stop(end + 0.01);
    const voice = {
      stop: (t: number) => {
        try {
          gain.gain.cancelScheduledValues(t);
          gain.gain.setValueAtTime(gain.gain.getValueAtTime(t), t);
          gain.gain.linearRampToValueAtTime(0, t + 0.01);
          node.stop(t + 0.015);
        } catch { /* stopped */ }
      },
    };
    s.audioVoices.add(voice);
    s.resources.add(node);
    s.resources.add(gain);
    const cleanup = () => {
      s.audioVoices.delete(voice);
      // Offline 'ended' fires on Tone's clock, ahead of the rendered audio - don't cut the clip short.
      if (!context.isOffline) { node.dispose(); gain.dispose(); s.resources.delete(node); s.resources.delete(gain); }
    };
    node.onended = cleanup;
  }

  private startFrozenVoice(s: Strip, time: number, elapsedBeats: number) {
    const f = s.frozen;
    if (!f) return;
    const offset = beatsToSeconds(this.project!, elapsedBeats);
    if (offset >= f.buffer.duration - 0.01) return;
    const context = this.context;
    const gain = new Tone.Gain({ gain: 0, context }).connect(s.channel);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(1, time + 0.01);
    const node = new Tone.ToneBufferSource({ context, url: f.buffer });
    node.connect(gain);
    node.start(time, offset);
    const voice = {
      stop: (t: number) => {
        try {
          gain.gain.cancelScheduledValues(t);
          gain.gain.setValueAtTime(gain.gain.getValueAtTime(t), t);
          gain.gain.linearRampToValueAtTime(0, t + 0.01);
          node.stop(t + 0.015);
        } catch { /* stopped */ }
      },
    };
    s.audioVoices.add(voice);
    s.resources.add(node);
    s.resources.add(gain);
    node.onended = () => { s.audioVoices.delete(voice); if (!context.isOffline) { node.dispose(); gain.dispose(); s.resources.delete(node); s.resources.delete(gain); } };
  }

  /** A track switched between live and frozen mid-playback: pick it up at the playhead. */
  private rechase(s: Strip) {
    const now = this.context.now() + 0.05;
    for (const v of s.audioVoices) v.stop(now);
    s.audioVoices.clear();
    s.instrument?.releaseAll(now);
    const pos = (this.transport.getSecondsAtTime(now) * this.project!.bpm) / 60;
    if (s.frozen && pos > s.frozen.startBeat) this.startFrozenVoice(s, now, pos - s.frozen.startBeat);
    if (!s.frozen) for (const c of s.track.clips) if (c.type === 'audio' && !c.muted && c.start < pos && c.start + c.length > pos) this.startAudioVoice(s, c, now, pos - c.start);
    if (!s.frozen) this.chaseMidi(s, now, pos);
  }

  private chaseMidi(s: Strip, time: number, pos: number) {
    if (s.ghost || s.track.kind !== 'instrument' || !s.instrument) return;
    for (const c of s.track.clips) {
      if (c.muted || c.type !== 'midi' || c.start >= pos || c.start + c.length <= pos) continue;
      for (const n of c.notes) {
        const start = c.start + n.start + this.swingOffset(c.start + n.start);
        const end = Math.min(c.start + c.length, start + n.duration);
        if (start < pos - 1e-4 && end > pos) s.instrument.trigger(n.pitch, beatsToSeconds(this.project!, end - pos), time, n.velocity);
      }
    }
  }

  /** On play/loop, start any audio clip whose start we've already passed. */
  private chaseAudio(time: number, offsetSec: number) {
    const p = this.project;
    if (!p) return;
    this.alignLfos(time, offsetSec);
    const pos = (offsetSec * p.bpm) / 60;
    for (const s of this.strips.values()) {
      if (s.ghost) continue;
      if (s.frozen) {
        if (pos > s.frozen.startBeat + 1e-4) this.startFrozenVoice(s, time, pos - s.frozen.startBeat);
        continue;
      }
      for (const c of s.track.clips) {
        if (c.type !== 'audio' || c.muted) continue;
        if (c.start < pos - 1e-4 && c.start + c.length > pos + 1e-3) this.startAudioVoice(s, c, time, pos - c.start);
      }
      this.chaseMidi(s, time, pos);
    }
  }

  /** Put every modulation LFO where it would be at this song position. */
  alignLfos(time: number, songSeconds: number) {
    for (const f of this.masterFx) f.unit.lfo?.align(time, songSeconds);
    for (const s of this.strips.values()) {
      s.instrument?.lfo?.align(time, songSeconds);
      for (const f of s.fx) f.unit.lfo?.align(time, songSeconds);
    }
  }

  /** Units built mid-playback join the song's LFO phase instead of free-running. */
  private alignIfPlaying(clock: { lfo?: { align(time: number, songSeconds: number): void } } | null) {
    if (!clock?.lfo || this.transport.state !== 'started') return;
    const at = this.context.now() + 0.02;
    clock.lfo.align(at, this.transport.getSecondsAtTime(at));
  }

  private stopVoices(time: number, releaseInstruments = false) {
    for (const s of this.strips.values()) {
      for (const v of s.audioVoices) v.stop(time);
      s.audioVoices.clear();
      if (releaseInstruments) s.instrument?.releaseAll(time);
    }
  }

  // ---------------------------------------------------------------- metronome

  private metronomeOn = false;
  setMetronome(on: boolean) {
    this.metronomeOn = on;
    this.syncMetronome();
  }

  private syncMetronome() {
    if (!this.opts.live) return;
    if (this.metronomeId !== null) { this.transport.clear(this.metronomeId); this.metronomeId = null; }
    if (!this.metronomeOn || !this.project) return;
    if (!this.clickBuffers) {
      const mk = (f: number) => {
        const sr = this.context.sampleRate;
        const b = this.context.createBuffer(1, Math.floor(sr * 0.03), sr);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.sin((2 * Math.PI * f * i) / sr) * Math.exp(-i / (sr * 0.006));
        return b;
      };
      this.clickBuffers = { hi: mk(1800), lo: mk(1100) };
    }
    const bpb = this.project.timeSignature[0] * (4 / this.project.timeSignature[1]);
    this.metronomeId = this.transport.scheduleRepeat((time) => {
      const beat = Math.round(this.transport.getTicksAtTime(time) / this.transport.PPQ);
      const src = new Tone.ToneBufferSource({ context: this.context, url: beat % bpb === 0 ? this.clickBuffers!.hi : this.clickBuffers!.lo }).connect(this.masterChannel);
      src.start(time);
      src.onended = () => src.dispose();
    }, '4n', 0);
  }

  // ---------------------------------------------------------------- live helpers

  /** Preview a note on a track (piano roll clicks, typing). */
  previewNote(trackId: string, midi: number, velocity = 0.8, durSec = 0.4) {
    const s = this.strips.get(trackId);
    if (!s) return;
    const now = this.context.now() + 0.01;
    if (s.frozen) {
      s.liveGate.gain.cancelScheduledValues(now);
      s.liveGate.gain.setValueAtTime(1, now);
      s.liveGate.gain.setValueAtTime(0, now + durSec + trackTail(s.track, this.project!.bpm));
    }
    if (s.track.kind === 'drums') {
      const lane = s.track.drumLanes?.find((l) => l.note === midi);
      if (lane) this.triggerDrum(s, lane, now, velocity);
    } else {
      s.instrument?.trigger(midi, durSec, now, velocity);
    }
  }

  // Gesto Studio plays pads by hand. Each track gets a second, monitor-only instance of its
  // instrument on the same input and effects, so letting go of a held chord never cuts the
  // song's own notes on that track.
  private monitors = new Map<string, { key: string; params: Record<string, number>; inst: Instrument }>();
  private monitorLoads = new Map<string, Promise<Instrument | null>>();

  private async monitorFor(s: Strip): Promise<Instrument | null> {
    const spec = s.track.instrument;
    if (s.track.kind !== 'instrument' || !spec) return null;
    const ready = this.monitors.get(s.id);
    if (ready && ready.key === s.instKey) {
      if (ready.params !== spec.params) { ready.inst.setParams(spec.params); ready.params = spec.params; }
      return ready.inst;
    }
    const loading = this.monitorLoads.get(s.id);
    if (loading) return loading;
    const key = s.instKey;
    const load = (async () => {
      const assets = await prepareInstrument(spec);
      if (this.disposed || this.strips.get(s.id) !== s) return null;
      const old = this.monitors.get(s.id);
      old?.inst.releaseAll();
      old?.inst.dispose();
      const inst = createInstrument(spec, assets);
      inst.output.connect(s.input);
      this.monitors.set(s.id, { key, params: spec.params, inst });
      return inst;
    })().finally(() => this.monitorLoads.delete(s.id));
    this.monitorLoads.set(s.id, load);
    return load;
  }

  /** Frozen tracks mute their live chain; open it while a hand-played chord sounds. */
  private openLiveGate(s: Strip, now: number) {
    if (!s.frozen) return;
    s.liveGate.gain.cancelScheduledValues(now);
    s.liveGate.gain.setValueAtTime(1, now);
  }

  /** Hold a chord on a track until the next liveChord or liveRelease. `wanted` re-checks after loading. */
  async liveChord(trackId: string, midis: number[], velocity: number, wanted: () => boolean = () => true) {
    const s = this.strips.get(trackId);
    if (!s) return;
    const inst = await this.monitorFor(s);
    if (!inst || !wanted()) return;
    const now = this.context.now() + 0.01;
    inst.releaseAll(now);
    this.openLiveGate(s, now);
    for (const m of midis) inst.trigger(m, LIVE_HOLD_SEC, now, velocity);
  }

  /** One short note on the monitor, next to whatever is held (arpeggiator steps). */
  async liveNote(trackId: string, midi: number, durSec: number, velocity: number, wanted: () => boolean = () => true) {
    const s = this.strips.get(trackId);
    if (!s) return;
    const inst = await this.monitorFor(s);
    if (!inst || !wanted()) return;
    const now = this.context.now() + 0.01;
    this.openLiveGate(s, now);
    inst.trigger(midi, durSec, now, velocity);
  }

  /** Let go of everything played by hand on a track. */
  liveRelease(trackId: string) {
    const s = this.strips.get(trackId);
    const m = this.monitors.get(trackId);
    if (!s || !m) return;
    const now = this.context.now();
    m.inst.releaseAll(now);
    if (s.frozen) s.liveGate.gain.setValueAtTime(0, now + trackTail(s.track, this.project!.bpm));
  }

  trackLevel(trackId: string): number {
    const m = this.strips.get(trackId)?.meter;
    if (!m) return -Infinity;
    const v = m.getValue();
    return typeof v === 'number' ? v : Math.max(...v);
  }

  masterLevel(): number[] {
    if (!this.masterMeter) return [-Infinity, -Infinity];
    const v = this.masterMeter.getValue();
    return typeof v === 'number' ? [v, v] : v;
  }

  panic() {
    const now = this.context.now();
    this.stopVoices(now, true);
  }

  private disposeStrip(s: Strip) {
    for (const id of s.events) this.transport.clear(id);
    for (const v of s.audioVoices) v.stop(this.context.now());
    for (const resource of s.resources) resource.dispose();
    s.resources.clear();
    s.chokes.clear();
    s.instrument?.releaseAll();
    s.instrument?.dispose();
    const monitor = this.monitors.get(s.id);
    monitor?.inst.releaseAll();
    monitor?.inst.dispose();
    this.monitors.delete(s.id);
    s.fx.forEach((f) => f.unit.dispose());
    s.input.dispose();
    s.channel.dispose();
    s.liveGate.dispose();
    s.meter?.dispose();
    this.strips.delete(s.id);
  }

  dispose() {
    this.disposed = true;
    for (const s of [...this.strips.values()]) this.disposeStrip(s);
    if (this.metronomeId !== null) this.transport.clear(this.metronomeId);
    for (const [ev, fn] of this.listeners) this.transport.off(ev as 'start', fn as never);
    this.masterFx.forEach((f) => f.unit.dispose());
    this.masterIn.dispose();
    this.masterChannel.dispose();
    this.safety.dispose();
    this.safetyPre.dispose();
    this.masterMeter?.dispose();
    this.analyser?.dispose();
  }
}
