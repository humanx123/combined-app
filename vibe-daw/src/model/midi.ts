import type { Project } from './types';

// Standard MIDI File (format 1) export: tempo/meter track plus one track per
// instrument or drum track. Drums go on channel 10 using each lane's MIDI note,
// so kits map onto General MIDI drum sounds in any DAW.

const PPQ = 480;

function vlq(n: number): number[] {
  const bytes = [n & 0x7f];
  while ((n >>= 7) > 0) bytes.unshift((n & 0x7f) | 0x80);
  return bytes;
}

function str(s: string): number[] {
  return [...new TextEncoder().encode(s)];
}

function chunk(type: string, data: number[]): number[] {
  const len = data.length;
  return [...str(type), (len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff, ...data];
}

interface Ev { tick: number; order: number; bytes: number[] }

function trackChunk(events: Ev[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const out: number[] = [];
  let last = 0;
  for (const e of events) {
    out.push(...vlq(Math.max(0, e.tick - last)), ...e.bytes);
    last = e.tick;
  }
  out.push(0, 0xff, 0x2f, 0x00); // end of track
  return chunk('MTrk', out);
}

const metaText = (type: number, text: string) => {
  const b = str(text);
  return [0xff, type, ...vlq(b.length), ...b];
};

export function projectToMidi(p: Project): Uint8Array {
  const tracks: number[][] = [];
  const usPerBeat = Math.round(60_000_000 / p.bpm);
  const [num, den] = p.timeSignature;
  tracks.push(trackChunk([
    { tick: 0, order: 0, bytes: metaText(0x03, p.name) },
    { tick: 0, order: 1, bytes: [0xff, 0x51, 0x03, (usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff] },
    { tick: 0, order: 2, bytes: [0xff, 0x58, 0x04, num, Math.round(Math.log2(den)), 24, 8] },
    ...p.sections.map((s, i) => ({ tick: Math.round(s.start * PPQ), order: 3 + i, bytes: metaText(0x06, s.name) })),
  ]));

  let nextChannel = 0;
  const melodic = () => {
    if (nextChannel % 16 === 9) nextChannel++; // channel 10 is reserved for drums
    return nextChannel++ % 16;
  };
  for (const t of p.tracks) {
    if (t.kind === 'audio') continue;
    const drums = t.kind === 'drums';
    const ch = drums ? 9 : melodic();
    const events: Ev[] = [{ tick: 0, order: 0, bytes: metaText(0x03, t.name) }];
    for (const c of t.clips) {
      if (c.type !== 'midi' || c.muted) continue;
      for (const n of c.notes) {
        if (n.start < 0 || n.start >= c.length) continue;
        const on = Math.round((c.start + n.start) * PPQ);
        const len = drums ? 0.25 : Math.min(n.duration, c.length - n.start);
        const off = Math.max(on + 1, Math.round((c.start + n.start + len) * PPQ));
        const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)));
        const pitch = Math.max(0, Math.min(127, n.pitch));
        events.push({ tick: on, order: 2, bytes: [0x90 | ch, pitch, vel] });
        events.push({ tick: off, order: 1, bytes: [0x80 | ch, pitch, 0] }); // note-offs sort before note-ons at the same tick
      }
    }
    tracks.push(trackChunk(events));
  }

  const header = chunk('MThd', [0, 1, (tracks.length >> 8) & 0xff, tracks.length & 0xff, (PPQ >> 8) & 0xff, PPQ & 0xff]);
  return new Uint8Array([...header, ...tracks.flat()]);
}
