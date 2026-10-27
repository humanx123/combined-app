import { loadEngine } from '../../src/engine/api';
import { unlockAudio } from '../../src/engine/unlock';
import { frozenFor } from '../../src/engine/freeze';
import { createMidiClip, createProject, createTrack } from '../../src/model/project';
import { useDaw, useTransport } from '../../src/state/store';

// Run in Safari as well as Chromium: covers the gesture -> live graph -> background
// offline renders -> frozen playback path, without persistence or provider calls.
const output = document.querySelector<HTMLPreElement>('#result')!;
const button = document.querySelector<HTMLButtonElement>('#run')!;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const write = (s: string) => { output.textContent += s + '\n'; };
function check(ok: boolean, message: string) {
  if (!ok) throw new Error(message);
  write(`PASS ${message}`);
}

button.onclick = async () => {
  unlockAudio(); // Must stay synchronous in the click handler for iOS Safari.
  button.disabled = true;
  output.textContent = '';
  const engine = await loadEngine();
  try {
    const p = createProject('Safari playback regression');
    p.bpm = 120;
    for (let i = 0; i < 4; i++) {
      const t = createTrack(p, 'instrument', { preset: i % 2 ? 'epiano' : 'sub_bass' });
      t.volumeDb = -18;
      const c = createMidiClip(p, 0, 16);
      c.notes = Array.from({ length: 16 }, (_, n) => ({ id: String(n), start: n, duration: 0.8, pitch: 48 + n % 3, velocity: 0.6 }));
      t.clips.push(c);
      t.effects = [{ id: `r${i}`, type: 'reverb', enabled: true, params: { decay: 2, preDelay: 0.02, wet: 0.3 } }];
      p.tracks.push(t);
    }
    useDaw.getState().replaceProject(p);
    await engine.play(0);
    await wait(800);
    check(useTransport.getState().playing && useTransport.getState().position > 0, 'live playback advances');
    check(engine.getMasterLevels().some((db) => Number.isFinite(db) && db > -80), 'live playback produces audio');
    const deadline = performance.now() + 45000;
    while (!p.tracks.every((t) => frozenFor(p, t)) && performance.now() < deadline) await wait(100);
    check(p.tracks.every((t) => frozenFor(p, t)), 'background renders complete during playback');
    for (let i = 0; i < 3; i++) {
      engine.stop();
      await engine.play(0);
      await wait(800);
      check(engine.getMasterLevels().some((db) => Number.isFinite(db) && db > -80), `frozen playback restart ${i + 1} produces audio`);
    }
    const pcm = await (await import('../../src/engine/render')).renderProject(p, { endBeat: 4, tail: 0 });
    check(pcm.channels.every((c) => c.every(Number.isFinite)) && pcm.channels.some((c) => c.some((v) => Math.abs(v) > 0.001)), 'offline export produces finite, non-silent audio');
    write('DONE');
  } catch (e) { write(`ERROR: ${e instanceof Error ? e.stack : String(e)}`); }
  finally { engine.stop(); button.disabled = false; }
};
