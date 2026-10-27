/**
 * Audio graph builder.
 *
 * Turns a Project document into a live Tone.js graph. Used by both the
 * gesture synth (for the instrument chain) and the DAW (for the full mix).
 */

import * as Tone from 'tone';
import type { Project, Track, Clip } from '../types';

/** A node in the audio graph. */
interface GraphNode {
  id: string;
  node: Tone.AudioNode;
  children: GraphNode[];
}

/**
 * Builds a Tone.js audio graph from a project.
 *
 * The graph is built lazily: only tracks that are not muted and not soloed
 * (when solo is active) contribute to the output.
 */
export class EngineGraph {
  private root: GraphNode | null = null;
  private masterGain: Tone.Gain;

  constructor() {
    this.masterGain = new Tone.Gain(1).toDestination();
  }

  /** Build the graph from a project. */
  build(project: Project): void {
    // Dispose previous graph
    this.dispose();

    this.masterGain = new Tone.Gain(project.masterVolume).toDestination();

    const soloActive = project.tracks.some((t) => t.solo);

    for (const track of project.tracks) {
      if (track.muted) continue;
      if (soloActive && !track.solo) continue;

      const trackGain = new Tone.Gain(track.volume).connect(this.masterGain);
      const pan = new Tone.PanVol(track.pan, track.volume).connect(trackGain);

      for (const clip of track.clips) {
        if (clip.type === 'midi') {
          this.buildMidiClip(clip, track, pan);
        }
      }
    }
  }

  /** Build a MIDI clip into the graph. */
  private buildMidiClip(clip: Clip, track: Track, destination: Tone.AudioNode): void {
    if (!clip.notes || clip.notes.length === 0) return;

    const synth = new Tone.Synth().connect(destination);

    // Schedule notes relative to clip start
    const clipStartSeconds = (clip.start / (60 / 60)) * 60; // beats → seconds at 60 BPM
    for (let i = 0; i < clip.notes.length; i++) {
      const note = clip.notes[i];
      const offset = (i / clip.notes.length) * 0.5; // spread notes across a beat
      synth.triggerAttackRelease(
        Tone.MidiToFrequency(note),
        '8n',
        clipStartSeconds + offset,
        0.8,
      );
    }
  }

  /** Get the master gain node. */
  getMaster(): Tone.Gain {
    return this.masterGain;
  }

  /** Dispose the graph and free resources. */
  dispose(): void {
    if (this.root) {
      this.disposeNode(this.root);
      this.root = null;
    }
    if (this.masterGain) {
      this.masterGain.dispose();
    }
  }

  private disposeNode(node: GraphNode): void {
    for (const child of node.children) {
      this.disposeNode(child);
    }
    try {
      node.node.dispose();
    } catch {
      // Ignore disposal errors.
    }
  }
}