import type { Note, Project } from './types';
import { beatsPerBar, createMidiClip, createTrack, mintId, uid } from './project';

export interface ImportedMidiTrack { name: string; channel: number; program: number; notes: Note[] }
export interface ImportedMidi { tracks: ImportedMidiTrack[]; bpm?: number; timeSignature?: [number, number]; warnings: string[] }

/** Bounded SMF format 0/1 parser. Note positions stay in quarter-note beats. */
export function parseMidi(input: ArrayBuffer): ImportedMidi {
  if (input.byteLength > 16 * 1024 * 1024) throw new Error('Choose a MIDI file under 16 MB');
  const bytes = new Uint8Array(input), view = new DataView(input);
  let offset = 0, limit = bytes.length, notesSeen = 0, eventsSeen = 0;
  const need = (n: number) => { if (n < 0 || offset + n > limit) throw new Error('Truncated MIDI file'); };
  const byte = () => { need(1); return bytes[offset++]; };
  const word = () => { need(2); const n = view.getUint16(offset); offset += 2; return n; };
  const dword = () => { need(4); const n = view.getUint32(offset); offset += 4; return n; };
  const ascii = (n: number) => { need(n); const s = String.fromCharCode(...bytes.subarray(offset, offset + n)); offset += n; return s; };
  const vlq = () => {
    let value = 0;
    for (let i = 0; i < 4; i++) { const b = byte(); value = value * 128 + (b & 127); if (!(b & 128)) return value; }
    throw new Error('Invalid MIDI variable-length value');
  };
  if (ascii(4) !== 'MThd') throw new Error('This is not a Standard MIDI file');
  const headerLength = dword(); if (headerLength < 6) throw new Error('Invalid MIDI header');
  need(headerLength); const headerEnd = offset + headerLength;
  const format = word(), trackCount = word(), ppq = word(); offset = headerEnd;
  if (format > 1) throw new Error('Only MIDI formats 0 and 1 are supported');
  if (!ppq || ppq & 0x8000) throw new Error('SMPTE-timed MIDI is not supported; export a beat-based MIDI file');
  if (!trackCount || trackCount > 256 || (format === 0 && trackCount !== 1)) throw new Error('Invalid MIDI track count');
  const tracks: ImportedMidiTrack[] = [], warnings = new Set<string>();
  const tempos: Array<{ tick: number; value: number }> = [], meters: Array<{ tick: number; value: [number, number] }> = [];
  for (let index = 0; index < trackCount; index++) {
    limit = bytes.length;
    if (ascii(4) !== 'MTrk') throw new Error('Missing MIDI track chunk');
    const length = dword(); need(length); limit = offset + length;
    let tick = 0, running = 0, name = '';
    const programs = new Array<number>(16).fill(0), pedal = new Array<boolean>(16).fill(false);
    const groups = new Map<number, ImportedMidiTrack>();
    type Held = { pitch: number; start: number; velocity: number; released: boolean };
    const held = new Map<number, Held[]>();
    const group = (channel: number) => {
      let g = groups.get(channel);
      if (!g) { g = { name: '', channel, program: programs[channel], notes: [] }; groups.set(channel, g); }
      return g;
    };
    const finish = (channel: number, n: Held) => {
      group(channel).notes.push({ id: uid(), pitch: n.pitch, start: n.start / ppq, duration: Math.max(1, tick - n.start) / ppq, velocity: n.velocity });
      if (++notesSeen > 200_000) throw new Error('This MIDI file has too many notes');
    };
    while (offset < limit) {
      if (++eventsSeen > 1_000_000) throw new Error('This MIDI file has too many events');
      tick += vlq();
      if (tick / ppq > 1_000_000) throw new Error('MIDI timeline is too long');
      let status = byte();
      if (status < 0x80) { if (!running) throw new Error('Invalid MIDI running status'); offset--; status = running; }
      if (status === 0xff) {
        const type = byte(), size = vlq(); need(size);
        const data = bytes.subarray(offset, offset + size); offset += size;
        if (type === 3) name = new TextDecoder().decode(data).replace(/[\x00-\x1f]/g, '').slice(0, 120);
        if (type === 0x51 && size === 3) { const us = data[0] * 65536 + data[1] * 256 + data[2]; if (us) tempos.push({ tick, value: us }); }
        if (type === 0x58 && size >= 2 && data[0] > 0 && data[0] <= 64 && data[1] <= 6) meters.push({ tick, value: [data[0], 2 ** data[1]] });
        if (type === 0x2f) break;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) { running = 0; const size = vlq(); need(size); offset += size; continue; }
      if (status < 0x80 || status >= 0xf0) throw new Error('Unsupported MIDI system event');
      running = status;
      const channel = status & 15, type = status >> 4;
      const a = byte(), b = type === 0xc || type === 0xd ? 0 : byte();
      if (a > 127 || b > 127) throw new Error('Invalid MIDI event data');
      const key = channel * 128 + a;
      if (type === 0x9 && b > 0) {
        group(channel);
        const ns = held.get(key) ?? []; ns.push({ pitch: a, start: tick, velocity: b / 127, released: false }); held.set(key, ns);
      } else if (type === 0x8 || type === 0x9) {
        const ns = held.get(key) ?? [], at = ns.findIndex((n) => !n.released);
        if (at >= 0) { if (pedal[channel]) ns[at].released = true; else { finish(channel, ns[at]); ns.splice(at, 1); } }
      } else if (type === 0xb && a === 64) {
        pedal[channel] = b >= 64;
        if (!pedal[channel]) for (const [key, ns] of held) if (Math.floor(key / 128) === channel) {
          ns.filter((n) => n.released).forEach((n) => finish(channel, n)); held.set(key, ns.filter((n) => !n.released));
        }
      } else if (type === 0xc) {
        if (groups.has(channel) && programs[channel] !== a) warnings.add('Instrument changes within a MIDI track use its first instrument.');
        programs[channel] = a;
      } else if (type === 0xe || (type === 0xb && a !== 64)) warnings.add('Pitch bend and continuous controller automation are not imported yet.');
    }
    for (const [key, ns] of held) for (const n of ns) { finish(Math.floor(key / 128), n); warnings.add('Unreleased notes were closed at the end of their MIDI track.'); }
    for (const g of groups.values()) if (g.notes.length) {
      g.name = `${name || `MIDI track ${index + 1}`}${groups.size > 1 ? ` · Ch ${g.channel + 1}` : ''}`;
      g.notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch); tracks.push(g);
    }
    offset = limit;
  }
  if (!tracks.length) throw new Error('This MIDI file contains no editable notes');
  tempos.sort((a, b) => a.tick - b.tick); meters.sort((a, b) => a.tick - b.tick);
  if (tempos.some((t) => t.value !== tempos[0].value)) warnings.add('Tempo changes are not imported yet; the first tempo is used for a new project.');
  if (meters.some((m) => m.value.join('/') !== meters[0].value.join('/'))) warnings.add('Meter changes are not imported yet; the first time signature is used for a new project.');
  const bpm = tempos.length ? 60_000_000 / tempos[0].value : undefined;
  if (bpm && (bpm < 1 || bpm > 1000)) throw new Error('MIDI tempo is outside Vibe’s supported range');
  return { tracks, bpm, timeSignature: meters[0]?.value, warnings: [...warnings] };
}

function presetFor(program: number): string {
  if (program < 8) return program >= 4 ? 'epiano' : 'piano';
  if (program < 16) return program >= 12 ? 'xylophone' : 'bell';
  if (program < 24) return 'organ'; if (program < 32) return 'acoustic_guitar';
  if (program < 40) return 'electric_bass'; if (program < 56) return 'strings';
  if (program < 80) return 'flute'; if (program < 88) return 'lead';
  if (program < 96) return 'pad'; return 'pluck';
}
const drumSound = (pitch: number): [string, string] => {
  if ([35, 36].includes(pitch)) return ['Kick', 'b-kick-punchy'];
  if ([38, 40].includes(pitch)) return ['Snare', 'b-snare-trap'];
  if (pitch === 39) return ['Clap', 'b-clap-wide'];
  if ([42, 44].includes(pitch)) return ['Hat', 'b-hat-tight'];
  if (pitch === 46) return ['Open hat', 'b-openhat'];
  if ([49, 51, 52, 55, 57, 59].includes(pitch)) return ['Cymbal', pitch === 51 || pitch === 59 ? 'b-ride' : 'b-crash'];
  if ([41, 43, 45, 47, 48, 50].includes(pitch)) return ['Tom', 'b-perc-tom'];
  return ['Percussion', 'b-perc-conga'];
};

/** Add imported tracks in one undo step; preserve an existing song's tempo and meter. */
export function insertMidi(project: Project, midi: ImportedMidi, at = 0) {
  if (!Number.isFinite(at) || at < 0) throw new Error('Invalid MIDI destination');
  if (!project.tracks.length) { if (midi.bpm) project.bpm = midi.bpm; if (midi.timeSignature) project.timeSignature = [...midi.timeSignature]; }
  const ids: string[] = [], bpb = beatsPerBar(project);
  for (const imported of midi.tracks) {
    const drums = imported.channel === 9;
    const t = createTrack(project, drums ? 'drums' : 'instrument', { preset: presetFor(imported.program), name: imported.name });
    if (drums) t.drumLanes = [...new Set(imported.notes.map((n) => n.pitch))].map((note) => {
      const [name, sampleId] = drumSound(note);
      return { id: mintId(project, 'ln'), name: `${name} ${note}`, note, sampleId, gainDb: 0, pitch: 0, choke: [42, 44, 46].includes(note) ? 1 : undefined };
    });
    let end = bpb; for (const n of imported.notes) end = Math.max(end, n.start + n.duration);
    const clip = createMidiClip(project, at, Math.ceil(end / bpb) * bpb, imported.name);
    clip.notes = imported.notes.map((n) => ({ ...n, id: uid() })); t.clips.push(clip); project.tracks.push(t); ids.push(t.id);
  }
  return ids;
}
