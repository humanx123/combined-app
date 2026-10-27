import type { Clip, Note } from '../model/types';

// In-app clipboard for notes and clips. Positions are stored relative to the earliest
// item so a paste can land anywhere.

let notes: { items: Note[]; span: number } | null = null;
let clips: { items: Array<{ clip: Clip; trackId: string }>; span: number } | null = null;

export function copyNotes(selected: Note[]) {
  if (!selected.length) return;
  const start = Math.min(...selected.map((n) => n.start));
  const end = Math.max(...selected.map((n) => n.start + n.duration));
  notes = { items: selected.map((n) => ({ ...n, start: n.start - start })), span: end - start };
}

export function getCopiedNotes() {
  return notes;
}

export function copyClips(items: Array<{ clip: Clip; trackId: string }>) {
  if (!items.length) return;
  const start = Math.min(...items.map((i) => i.clip.start));
  const end = Math.max(...items.map((i) => i.clip.start + i.clip.length));
  clips = { items: items.map((i) => ({ trackId: i.trackId, clip: { ...structuredClone(i.clip), start: i.clip.start - start } })), span: end - start };
}

export function getCopiedClips() {
  return clips;
}
