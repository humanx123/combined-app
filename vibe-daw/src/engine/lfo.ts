import * as Tone from 'tone';

// Tone's Chorus, Phaser, Tremolo and Vibrato run free LFOs from whenever they were
// built, so the wobble lands somewhere different on every play and in every bounce.
// The engine restarts them at transport start and loop points, at the phase they
// would have reached from song time 0: playback, frozen tracks and exports then
// wobble identically, in time with the song.

/** Tone.LFO wraps a Tone.Oscillator, which wraps the native node that is playing. */
interface OscillatorInternals { phase: number; start(time: number): unknown; stop(time: number): unknown; _oscillator: unknown }
interface LfoInternals { _oscillator: OscillatorInternals }

export interface LfoClock {
  /** Restart every LFO at `time`, phased as if it had run since song time 0. */
  align(time: number, songSeconds: number): void;
}

export function lfoClock(...effects: Array<Tone.Chorus | Tone.Phaser | Tone.Tremolo | Tone.Vibrato>): LfoClock {
  // The effect's frequency signal drives its LFOs (an LFO's own param can read 0).
  const lfos: Array<{ lfo: Tone.LFO; base: number; hz: () => number }> = [];
  for (const effect of effects) {
    const n = effect as unknown as Record<string, unknown>;
    const hz = () => effect.toFrequency(effect.frequency.value);
    for (const lfo of [n._lfoL, n._lfoR, n._lfo]) if (lfo instanceof Tone.LFO) lfos.push({ lfo, base: lfo.phase, hz });
  }
  return {
    align(time, songSeconds) {
      for (const { lfo, base, hz } of lfos) {
        if (lfo.disposed) continue;
        // Offline, Tone hands transport events over up to a block late and clamps
        // starts to the current time; phase for when the restart really happens.
        const at = Math.max(time, lfo.context.currentTime);
        const turns = hz() * Math.max(0, songSeconds + at - time);
        // Tone's phase delays the waveform, so advancing it means subtracting.
        const phase = (((base - 360 * (turns - Math.floor(turns))) % 360) + 360) % 360;
        // Restart only the LFO's oscillator: Tone.LFO's own stop/start and phase setter
        // also drive a 'stopped value' that feeds its output past the depth control.
        const osc = (lfo as unknown as LfoInternals)._oscillator;
        osc.stop(at);
        // Setting the phase rewrites the running oscillator's waveform immediately;
        // detach it so only the oscillator that starts at `at` gets the new phase.
        const running = osc._oscillator;
        osc._oscillator = null;
        try { osc.phase = phase; } finally { osc._oscillator = running; }
        osc.start(at);
      }
    },
  };
}
