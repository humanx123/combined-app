/**
 * Plugin system for instruments and effects.
 *
 * A plugin is a factory that creates a Tone.js node (or node graph) from a
 * parameter map. This lets users and the AI assistant compose custom sounds
 * without touching the audio engine directly.
 */

import * as Tone from 'tone';
import type { InstrumentPreset, EffectInstance } from '../types';

/** A plugin that creates an instrument. */
export interface InstrumentPlugin {
  id: string;
  name: string;
  create: (params: Record<string, number>) => Tone.Instrument;
}

/** A plugin that creates an effect. */
export interface EffectPlugin {
  id: string;
  name: string;
  create: (params: Record<string, number>) => Tone.Effect;
}

/** A registry of available plugins. */
class PluginRegistry {
  private instruments = new Map<string, InstrumentPlugin>();
  private effects = new Map<string, EffectPlugin>();

  registerInstrument(plugin: InstrumentPlugin): void {
    this.instruments.set(plugin.id, plugin);
  }

  registerEffect(plugin: EffectPlugin): void {
    this.effects.set(plugin.id, plugin);
  }

  getInstrument(id: string): InstrumentPlugin | undefined {
    return this.instruments.get(id);
  }

  getEffect(id: string): EffectPlugin | undefined {
    return this.effects.get(id);
  }

  listInstruments(): InstrumentPlugin[] {
    return Array.from(this.instruments.values());
  }

  listEffects(): EffectPlugin[] {
    return Array.from(this.effects.values());
  }
}

/** Singleton registry. */
export const pluginRegistry = new PluginRegistry();

/** Built-in instrument plugins. */
export const builtInInstruments: InstrumentPlugin[] = [
  {
    id: 'sawtooth',
    name: 'Sawtooth Synth',
    create: (params) => {
      const synth = new Tone.Synth({
        oscillator: { type: 'sawtooth' },
        envelope: {
          attack: params.attack ?? 0.01,
          decay: params.decay ?? 0.5,
          sustain: params.sustain ?? 0.3,
          release: params.release ?? 1.0,
        },
      });
      return synth;
    },
  },
  {
    id: 'square',
    name: 'Square Synth',
    create: (params) =>
      new Tone.Synth({
        oscillator: { type: 'square' },
        envelope: {
          attack: params.attack ?? 0.01,
          decay: params.decay ?? 0.5,
          sustain: params.sustain ?? 0.3,
          release: params.release ?? 1.0,
        },
      }),
  },
  {
    id: 'fm',
    name: 'FM Bass',
    create: (params) =>
      new Tone.FMSynth({
        envelope: {
          attack: params.attack ?? 0.01,
          decay: params.decay ?? 0.5,
          sustain: params.sustain ?? 0.3,
          release: params.release ?? 1.0,
        },
      }),
  },
  {
    id: 'marimba',
    name: 'Marimba',
    create: () => new Tone.MembraneSynth({ pitchDecay: 0.1, octaves: 4 }),
  },
];

/** Built-in effect plugins. */
export const builtInEffects: EffectPlugin[] = [
  {
    id: 'filter',
    name: 'Low-pass Filter',
    create: (params) =>
      new Tone.Filter({
        type: 'lowpass',
        frequency: params.frequency ?? 400,
        Q: params.Q ?? 1,
      }),
  },
  {
    id: 'delay',
    name: 'Delay',
    create: (params) =>
      new Tone.Delay({
        delayTime: params.delayTime ?? 0.25,
        feedback: params.feedback ?? 0.3,
        maxDelay: params.maxDelay ?? 1,
      }),
  },
  {
    id: 'reverb',
    name: 'Reverb',
    create: (params) =>
      new Tone.Reverb({
        decay: params.decay ?? 1.5,
        preDelay: params.preDelay ?? 0.01,
      }),
  },
  {
    id: 'distortion',
    name: 'Distortion',
    create: (params) =>
      new Tone.Distortion({
        distortion: params.distortion ?? 0.4,
      }),
  },
];

// Register built-in plugins
for (const plugin of builtInInstruments) {
  pluginRegistry.registerInstrument(plugin);
}
for (const plugin of builtInEffects) {
  pluginRegistry.registerEffect(plugin);
}