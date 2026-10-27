import { configureFreeze, frozenFor, scheduleFreeze } from '../../src/engine/freeze';
import { renderProject } from '../../src/engine/render';
import { createMidiClip, createProject, createTrack } from '../../src/model/project';
import type { PcmData } from '../../src/engine/wav';

const output = document.querySelector<HTMLPreElement>('#result')!;
const button = document.querySelector<HTMLButtonElement>('#run')!;
const write = (s: string) => { output.textContent += s + '\n'; };

button.onclick = async () => {
  button.disabled = true;
  output.textContent = '';
  try {
    const p = createProject('Freeze benchmark');
    p.bpm = 120;
    for (let i = 0; i < 6; i++) {
      const t = createTrack(p, 'instrument', { preset: i % 2 ? 'epiano' : 'sub_bass' });
      const clip = createMidiClip(p, 8, 64);
      clip.notes = Array.from({ length: 128 }, (_, n) => ({ id: String(n), start: n / 2, duration: 0.4, pitch: 48 + n % 12, velocity: 0.6 }));
      t.clips.push(clip);
      t.effects = [{ id: `r${i}`, type: 'reverb', enabled: true, params: { decay: 2, preDelay: 0.02, wet: 0.3 } }];
      p.tracks.push(t);
    }
    const rate = 44100;
    const reference = new Map<string, PcmData>();
    write(`CPU cores: ${navigator.hardwareConcurrency}; tracks: ${p.tracks.length}`);
    // Warm shared impulses and Tone's initialization before either timing.
    await renderProject(p, { startBeat: 8, endBeat: 9, onlyTracks: [p.tracks[0].id], sampleRate: rate, master: false, reuseFrozen: false });
    const start = performance.now();
    for (const t of p.tracks) {
      const preFader = { ...p, tracks: p.tracks.map((x) => x.id === t.id ? { ...x, volumeDb: 0, pan: 0, mute: false, solo: false } : x) };
      reference.set(t.id, await renderProject(preFader, { startBeat: 8, endBeat: 72, onlyTracks: [t.id], sampleRate: rate, master: false, reuseFrozen: false }));
    }
    const serialMs = performance.now() - start;
    write(`Sequential rendering: ${serialMs.toFixed(0)} ms`);
    const freezeStart = performance.now();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Freeze timed out')), 60000);
      configureFreeze(rate, () => {
        if (p.tracks.every((t) => frozenFor(p, t))) { clearTimeout(timeout); resolve(); }
      });
      scheduleFreeze(p);
    });
    const totalMs = performance.now() - freezeStart;
    write(`Concurrent freezing: ${totalMs.toFixed(0)} ms including 1200 ms debounce; render phase ~${(totalMs - 1200).toFixed(0)} ms`);
    for (const t of p.tracks) {
      const f = frozenFor(p, t)!;
      const expected = reference.get(t.id)!;
      let diff = 0, energy = 0;
      for (let c = 0; c < 2; c++) {
        const actual = f.buffer.getChannelData(c), target = expected.channels[c];
        if (actual.length !== target.length) throw new Error(`Frame count mismatch: ${t.id}`);
        for (let i = 0; i < actual.length; i++) { diff += (actual[i] - target[i]) ** 2; energy += target[i] ** 2; }
      }
      const error = Math.sqrt(diff / Math.max(1e-20, energy));
      const pass = error < 0.0001 && energy > 0 && f.startBeat === 8 && f.buffer.sampleRate === rate;
      write(`${pass ? 'PASS' : 'FAIL'} ${t.id} ${t.instrument!.preset}: waveform error ${error.toFixed(6)}, offset ${f.startBeat}`);
    }
    write('DONE');
  } catch (e) { write(`ERROR: ${e instanceof Error ? e.stack : String(e)}`); }
  finally { button.disabled = false; }
};
