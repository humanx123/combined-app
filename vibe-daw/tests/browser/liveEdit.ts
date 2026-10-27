import { loadEngine } from '../../src/engine/api';
import { createMidiClip, createProject, createTrack } from '../../src/model/project';
import { useDaw, useTransport } from '../../src/state/store';

// Isolated from the app entry point: no project persistence or provider calls.
const output = document.querySelector<HTMLPreElement>('#result')!;
const button = document.querySelector<HTMLButtonElement>('#run')!;
const write = (s: string) => { output.textContent += s + '\n'; };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

button.onclick = async () => {
  button.disabled = true;
  output.textContent = '';
  const engine = await loadEngine();
  try {
    const p = createProject('Live edit check');
    p.bpm = 120;
    const t = createTrack(p, 'instrument', { preset: 'sub_bass' });
    t.volumeDb = -18;
    const clip = createMidiClip(p, 0, 32);
    clip.notes = Array.from({ length: 32 }, (_, i) => ({ id: String(i), start: i, duration: 0.8, pitch: 48 + i % 3, velocity: 0.6 }));
    t.clips.push(clip);
    p.tracks.push(t);
    useDaw.getState().replaceProject(p);
    await engine.play(4);
    await wait(500);
    for (let i = 0; i < 3; i++) {
      const before = useTransport.getState().position;
      useDaw.getState().update('Agent: notes and tempo', (d) => {
        d.bpm = 120 + i * 10;
        const c = d.tracks[0].clips[0];
        if (c.type === 'midi') c.notes.forEach((n) => { n.pitch = 48 + i; });
      });
      await engine.engineSettled();
      const held = useTransport.getState().position;
      const sameBeat = Math.abs(held - before) < 0.15;
      await wait(400);
      const after = useTransport.getState().position;
      const resumed = useTransport.getState().playing && after > held && after - held < 1.5;
      write(`${sameBeat && resumed ? 'PASS' : 'FAIL'} edit ${i + 1}: before ${before.toFixed(3)}, held ${held.toFixed(3)}, resumed ${after.toFixed(3)}`);
    }
    const levels = engine.getMasterLevels();
    write(`${levels.some((db) => Number.isFinite(db) && db > -80) ? 'PASS' : 'FAIL'} audio output after edits: ${levels.map((db) => db.toFixed(1)).join(', ')} dB`);
    write('DONE');
  } catch (e) { write(`ERROR: ${e instanceof Error ? e.stack : String(e)}`); }
  finally { engine.stop(); button.disabled = false; }
};
