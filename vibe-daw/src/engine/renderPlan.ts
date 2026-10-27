import type { Effect, Track } from '../model/types';

export function audibleTracks(tracks: Track[], onlyTracks?: string[] | null): Track[] {
  const anySolo = tracks.some((t) => t.solo);
  const selected = onlyTracks ? new Set(onlyTracks) : null;
  return tracks.filter((t) => selected ? selected.has(t.id) : !t.mute && (!anySolo || t.solo));
}

export function activeSpan(t: Track, from: number, to: number): [number, number] | null {
  let a = Infinity, b = -Infinity;
  for (const c of t.clips) {
    if (c.muted) continue;
    a = Math.min(a, c.start);
    b = Math.max(b, c.start + c.length);
  }
  const s = Math.max(from, a), e = Math.min(to, b);
  return e > s ? [s, e] : null;
}

function noteValueBeats(v: string): number {
  const m = /^(\d+)(n|t)(\.)?$/.exec(v.trim());
  if (!m || Number(m[1]) <= 0) return 0.5;
  return 4 / Number(m[1]) * (m[2] === 't' ? 2 / 3 : 1) * (m[3] ? 1.5 : 1);
}

export function effectTail(effects: Effect[], bpm: number): number {
  let tail = 0;
  for (const e of effects) {
    if (!e.enabled) continue;
    if (e.type === 'reverb') tail += Number(e.params.decay ?? 2.5) + Number(e.params.preDelay ?? 0.02);
    if (e.type === 'delay') {
      const sec = noteValueBeats(String(e.params.time ?? '8n.')) * 60 / bpm;
      const fb = Math.min(0.95, Math.max(0.01, Number(e.params.feedback ?? 0.35)));
      tail += Math.min(20, sec * (Math.log(0.001) / Math.log(fb) + 1));
    }
    if (['chorus', 'phaser', 'lofi'].includes(e.type)) tail += 0.1;
  }
  return Math.min(30, tail);
}

export function trackTail(t: Track, bpm: number): number {
  return Math.min(40, Math.max(0.5, t.instrument?.params.release ?? 0, t.instrument?.params.decay ?? 0) + effectTail(t.effects, bpm) + 0.3);
}
