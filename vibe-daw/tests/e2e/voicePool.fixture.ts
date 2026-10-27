import * as Tone from 'tone';
import { VoicePool } from '../../src/engine/voicePool';

export async function renderDenseVoices() {
  const checks: { finite: boolean; rms: number }[] = [];
  for (const Voice of [Tone.Synth, Tone.FMSynth, Tone.MonoSynth, Tone.AMSynth]) {
    let pool: VoicePool<Tone.Synth | Tone.FMSynth | Tone.MonoSynth | Tone.AMSynth> | undefined;
    const buffer = await Tone.Offline((context) => {
      pool = new VoicePool(Voice, { envelope: { attack: 0.005, decay: 0.01, sustain: 0.7, release: 1 } });
      pool.maxPolyphony = 2;
      pool.toDestination();
      for (let i = 0; i < 48; i++) {
        const at = 0.05 + i * 0.04;
        context.setTimeout(() => pool!.triggerAttackRelease(220 + (i % 8) * 40, 0.2, at, 0.4), at);
      }
    }, 2.5, 1, 22050);
    const data = buffer.getChannelData(0);
    let energy = 0;
    for (let i = Math.floor(1.6 * 22050); i < Math.floor(1.9 * 22050); i++) energy += data[i] ** 2;
    checks.push({ finite: data.every(Number.isFinite), rms: Math.sqrt(energy / (0.3 * 22050)) });
    pool!.dispose();
  }
  return checks;
}
