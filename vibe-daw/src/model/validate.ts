import type { Project } from './types';
import { EFFECT_BY_TYPE } from './catalog';
import { validateCustomEffect } from './customEffect';
import { PITCH_CLASSES, SCALES } from './theory';

type Obj = Record<string, unknown>;
const fail = (path: string): never => { throw new Error(`Invalid project file: ${path}`); };
function object(value: unknown, path: string): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(path);
  return value as Obj;
}
function string(value: unknown, path: string) { if (typeof value !== 'string') fail(path); }
function number(value: unknown, path: string, min = -Infinity, max = Infinity) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path);
}
function boolean(value: unknown, path: string) { if (typeof value !== 'boolean') fail(path); }
function array(value: unknown, path: string): unknown[] { if (!Array.isArray(value)) return fail(path); return value; }
function params(value: unknown, path: string, allowStrings = false) {
  for (const [k, v] of Object.entries(object(value, path))) {
    if (!(allowStrings && typeof v === 'string')) number(v, `${path}.${k}`);
  }
}

/** Validate files before they can reach editors, autosave or the audio engine. */
export function validateProject(value: unknown): Project {
  const p = object(value, 'project');
  if (p.schemaVersion !== 1) fail('unsupported schemaVersion');
  for (const k of ['id', 'name']) string(p[k], k);
  number(p.bpm, 'bpm', 1, 1000);
  number(p.swing, 'swing', 0, 1);
  number(p.nextId, 'nextId', 0, Number.MAX_SAFE_INTEGER);
  if (!Number.isInteger(p.nextId)) fail('nextId');
  for (const k of ['createdAt', 'updatedAt']) number(p[k], k, 0);
  const ts = array(p.timeSignature, 'timeSignature');
  if (ts.length !== 2 || !Number.isInteger(ts[0]) || Number(ts[0]) < 1 || Number(ts[0]) > 64 || ![1, 2, 4, 8, 16, 32, 64].includes(Number(ts[1]))) fail('timeSignature');
  const key = object(p.key, 'key');
  if (!PITCH_CLASSES.includes(key.root as never) || !Object.hasOwn(SCALES, String(key.scale))) fail('key');
  const loop = object(p.loop, 'loop');
  boolean(loop.enabled, 'loop.enabled');
  number(loop.start, 'loop.start', 0);
  number(loop.end, 'loop.end', 0);
  if (loop.enabled && Number(loop.end) <= Number(loop.start)) fail('loop.end must follow loop.start');
  const ids = new Set<string>();
  const id = (v: unknown, path: string) => {
    string(v, path);
    if (!v || ids.has(String(v))) fail(`${path} (empty or duplicate id)`);
    ids.add(String(v));
  };
  const effects = (value: unknown, path: string) => {
    for (const item of array(value, path)) {
      const e = object(item, path);
      id(e.id, `${path}.id`);
      if (!Object.hasOwn(EFFECT_BY_TYPE, String(e.type))) fail(`${path}.type`);
      boolean(e.enabled, `${path}.enabled`);
      params(e.params, `${path}.params`, true);
      if (e.type === 'custom') {
        try { validateCustomEffect(e.custom); } catch (error) { fail(`${path}.custom: ${(error as Error).message}`); }
      } else if (e.custom !== undefined) fail(`${path}.custom`);
    }
  };
  const master = object(p.master, 'master');
  number(master.volumeDb, 'master.volumeDb', -120, 24);
  effects(master.effects, 'master.effects');
  for (const item of array(p.sections, 'sections')) {
    const s = object(item, 'section');
    id(s.id, 'section.id'); string(s.name, 'section.name');
    number(s.start, 'section.start', 0); number(s.length, 'section.length', Number.MIN_VALUE);
  }
  for (const item of array(p.tracks, 'tracks')) {
    const t = object(item, 'track');
    id(t.id, 'track.id');
    for (const k of ['name', 'color']) string(t[k], `track.${k}`);
    if (!['instrument', 'drums', 'audio'].includes(String(t.kind))) fail('track.kind');
    number(t.volumeDb, 'track.volumeDb', -120, 24); number(t.pan, 'track.pan', -1, 1);
    boolean(t.mute, 'track.mute'); boolean(t.solo, 'track.solo');
    effects(t.effects, 'track.effects');
    if (t.instrument !== undefined) {
      const i = object(t.instrument, 'instrument');
      string(i.preset, 'instrument.preset'); params(i.params, 'instrument.params');
    }
    if (t.drumLanes !== undefined) for (const item of array(t.drumLanes, 'drumLanes')) {
      const l = object(item, 'drumLane');
      id(l.id, 'drumLane.id'); string(l.name, 'drumLane.name'); string(l.sampleId, 'drumLane.sampleId');
      number(l.note, 'drumLane.note', 0, 127); number(l.gainDb, 'drumLane.gainDb', -120, 24); number(l.pitch, 'drumLane.pitch', -96, 96);
      if (l.choke !== undefined) number(l.choke, 'drumLane.choke', 0);
    }
    for (const item of array(t.clips, 'clips')) {
      const c = object(item, 'clip');
      id(c.id, 'clip.id'); string(c.name, 'clip.name');
      number(c.start, 'clip.start', 0); number(c.length, 'clip.length', Number.MIN_VALUE);
      if (c.muted !== undefined) boolean(c.muted, 'clip.muted');
      if (c.type === 'midi') {
        const noteIds = new Set<string>();
        for (const item of array(c.notes, 'notes')) {
          const n = object(item, 'note'); string(n.id, 'note.id');
          if (noteIds.has(String(n.id))) fail('duplicate note.id');
          noteIds.add(String(n.id));
          number(n.pitch, 'note.pitch', 0, 127); number(n.start, 'note.start', 0);
          number(n.duration, 'note.duration', Number.MIN_VALUE); number(n.velocity, 'note.velocity', 0, 1);
        }
      } else if (c.type === 'audio') {
        string(c.sampleId, 'clip.sampleId'); number(c.offset, 'clip.offset', 0);
        number(c.gainDb, 'clip.gainDb', -120, 24); number(c.pitch, 'clip.pitch', -96, 96);
        boolean(c.loop, 'clip.loop'); boolean(c.reverse, 'clip.reverse');
        if (!['off', 'resample', 'stretch'].includes(String(c.warp))) fail('clip.warp');
        number(c.fadeIn, 'clip.fadeIn', 0); number(c.fadeOut, 'clip.fadeOut', 0);
      } else fail('clip.type');
    }
  }
  if (p.annotations !== undefined) {
    const annotations = array(p.annotations, 'annotations');
    if (annotations.length > 5000) fail('too many annotations');
    for (const item of annotations) {
      const a = object(item, 'annotation');
      id(a.id, 'annotation.id');
      if (!['note', 'lyric'].includes(String(a.kind))) fail('annotation.kind');
      string(a.text, 'annotation.text');
      if (!(a.text as string).trim() || (a.text as string).length > 4000) fail('annotation.text');
      number(a.start, 'annotation.start', 0, 1e7); number(a.length, 'annotation.length', Number.MIN_VALUE, 1e7);
      if (!['user', 'producer'].includes(String(a.author))) fail('annotation.author');
      if (a.trackId !== undefined) string(a.trackId, 'annotation.trackId');
      if (a.resolved !== undefined) boolean(a.resolved, 'annotation.resolved');
      if (a.aiPending !== undefined) boolean(a.aiPending, 'annotation.aiPending');
    }
  }
  // Imported counters must not collide with ids minted by later edits.
  let nextId = Number(p.nextId);
  for (const value of ids) { const m = /^(?:t|c|fx|ln|s|a)(\d+)$/.exec(value); if (m) nextId = Math.max(nextId, Number(m[1])); }
  return { ...(p as unknown as Project), nextId };
}
