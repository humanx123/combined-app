import * as Tone from 'tone';

type Voice = Tone.Synth | Tone.FMSynth | Tone.MonoSynth | Tone.AMSynth;
type Slot<V> = { voice: V; start: number; releaseAt: number; until: number };

function merge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = { ...a };
  for (const [key, value] of Object.entries(b)) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge((out[key] ?? {}) as Record<string, unknown>, value as Record<string, unknown>) : value;
  }
  return out;
}

/** Fixed-size synth pool. Prefer free voices, then release tails, then oldest notes. */
export class VoicePool<V extends Voice> extends Tone.ToneAudioNode {
  readonly name = 'VoicePool';
  readonly input = undefined;
  readonly output = new Tone.Gain({ context: this.context });
  maxPolyphony = 24;
  private slots: Slot<V>[] = [];
  private options: Record<string, unknown>;

  constructor(private VoiceClass: new (...args: never[]) => V, options: Parameters<V['set']>[0]) {
    super();
    this.options = options as Record<string, unknown>;
  }

  set(options: Parameters<V['set']>[0]) {
    this.options = merge(this.options, options as Record<string, unknown>);
    for (const slot of this.slots) slot.voice.set(options as never);
    return this;
  }

  triggerAttackRelease(frequency: number, duration: number, time: number, velocity = 1) {
    let slot = this.slots.find((candidate) => candidate.until <= time);
    if (!slot && this.slots.length < this.maxPolyphony) {
      const voice = new this.VoiceClass({ ...this.options, context: this.context } as never);
      voice.connect(this.output);
      slot = { voice, start: -Infinity, releaseAt: -Infinity, until: -Infinity };
      this.slots.push(slot);
    }
    if (!slot) {
      // Re-attacking the envelope cancels its old scheduled release. No private
      // Tone fields, dropped note, unbounded allocation, or console suppression.
      slot = [...this.slots].sort((a, b) => Number(a.releaseAt > time) - Number(b.releaseAt > time) || a.start - b.start)[0];
    }
    const settings = slot.voice.get() as { envelope?: { release?: number }; modulationEnvelope?: { release?: number }; filterEnvelope?: { release?: number } };
    const release = Math.max(settings.envelope?.release ?? 0, settings.modulationEnvelope?.release ?? 0, settings.filterEnvelope?.release ?? 0);
    slot.start = time;
    slot.releaseAt = time + duration;
    slot.until = time + duration + release;
    slot.voice.triggerAttackRelease(frequency, duration, time, velocity);
  }

  releaseAll(time = this.now()) {
    for (const slot of this.slots) {
      slot.voice.triggerRelease(time);
      slot.until = Math.min(slot.until, time + Math.max(0, slot.until - slot.releaseAt));
      slot.releaseAt = Math.min(slot.releaseAt, time);
    }
  }

  dispose() {
    super.dispose();
    this.slots.forEach((slot) => slot.voice.dispose());
    this.slots = [];
    this.output.dispose();
    return this;
  }
}
