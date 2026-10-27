/**
 * Unified audio engine for the combined gesture-DAW platform.
 *
 * Wraps Tone.js behind a single shared AudioContext so that the gesture
 * synthesizer and the DAW share one audio graph. This keeps latency low and
 * avoids the browser's limit of one audio context per tab.
 *
 * All methods are idempotent: calling them twice with the same arguments is
 * safe and returns the same node instance.
 */

import * as Tone from 'tone';
import type { MidiNote, Seconds, Velocity } from '../types';

/** A node factory that creates a fresh node on demand. */
type NodeFactory<T extends Tone.AudioNode> = () => T;

/** A registered node keyed by a stable id. */
interface RegisteredNode {
  id: string;
  node: Tone.AudioNode;
  factory: NodeFactory<Tone.AudioNode>;
}

/**
 * The unified audio engine.
 *
 * Usage:
 * ```ts
 * import { audioEngine } from '@combined-app/engine';
 *
 * const synth = audioEngine.createSynth('my-synth', () => new Tone.Synth());
 * synth.triggerAttackRelease('C4', '8n', 0, 0.8);
 * ```
 */
class UnifiedAudioEngine {
  private context: Tone.Context | null = null;
  private masterGain: Tone.Gain | null = null;
  private nodes = new Map<string, RegisteredNode>();
  private initialized = false;

  /** Get the shared Tone context, creating it on first access. */
  getContext(): Tone.Context {
    if (!this.context) {
      this.context = Tone.getContext();
    }
    return this.context;
  }

  /** Get the shared master gain node. */
  getMasterGain(): Tone.Gain {
    if (!this.masterGain) {
      this.masterGain = new Tone.Gain(1).toDestination();
    }
    return this.masterGain;
  }

  /** Start the audio context (must be called after a user gesture). */
  async start(): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    this.initialized = true;
  }

  /** Current time in seconds from the audio context clock. */
  now(): Seconds {
    return this.getContext().currentTime;
  }

  /** Current tempo in BPM. */
  get tempo(): number {
    return Tone.getTransport().bpm.value;
  }

  set tempo(bpm: number) {
    Tone.getTransport().bpm.value = bpm;
  }

  /**
   * Create or reuse a node by id.
   *
   * If a node with the same id already exists, it is returned as-is. Otherwise
   * the factory is called and the result is registered.
   */
  createNode<T extends Tone.AudioNode>(id: string, factory: NodeFactory<T>): T {
    const existing = this.nodes.get(id);
    if (existing) {
      return existing.node as T;
    }
    const node = factory();
    this.nodes.set(id, { id, node, factory });
    return node;
  }

  /** Remove a node from the engine and disconnect it. */
  removeNode(id: string): void {
    const registered = this.nodes.get(id);
    if (registered) {
      try {
        registered.node.disconnect();
      } catch {
        // Node may not be connected; that's fine.
      }
      this.nodes.delete(id);
    }
  }

  /** Connect a source node to a destination node. */
  connect(source: Tone.AudioNode, destination: Tone.AudioNode): void {
    source.connect(destination);
  }

  /** Disconnect a source node from a destination node. */
  disconnect(source: Tone.AudioNode, destination?: Tone.AudioNode): void {
    source.disconnect(destination);
  }

  /**
   * Schedule a one-shot note.
   *
   * @param note    MIDI note number
   * @param velocity Amplitude 0-1
   * @param when    Time in seconds (absolute or relative to now)
   * @param duration Duration in seconds
   */
  scheduleNote(
    note: MidiNote,
    velocity: Velocity,
    when: Seconds,
    duration: Seconds,
    synthId?: string,
  ): void {
    const synth = synthId
      ? this.createNode(synthId, () => new Tone.Synth())
      : this.createNode('default-synth', () => new Tone.Synth());
    synth.triggerAttackRelease(Tone.MidiToFrequency(note), duration, when, velocity);
  }

  /** Stop all currently sounding notes on a synth. */
  releaseAll(synthId: string): void {
    const registered = this.nodes.get(synthId);
    if (registered && 'triggerRelease' in registered.node) {
      (registered.node as Tone.Synth).triggerRelease();
    }
  }

  /** Dispose all nodes and reset the engine. */
  dispose(): void {
    for (const registered of this.nodes.values()) {
      try {
        registered.node.dispose();
      } catch {
        // Ignore disposal errors for already-disposed nodes.
      }
    }
    this.nodes.clear();
    if (this.masterGain) {
      this.masterGain.dispose();
      this.masterGain = null;
    }
    this.initialized = false;
  }
}

/** Singleton instance shared across the gesture synth and the DAW. */
export const audioEngine = new UnifiedAudioEngine();