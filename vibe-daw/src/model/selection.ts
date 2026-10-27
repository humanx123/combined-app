import type { Project, Note } from './types';

/** A snapshot in song beats; never persisted in the project document. */
export interface EditSelection {
  clipIds: string[];
  notes?: Array<{ clipId: string; noteIds: string[] }>;
  range?: { start: number; end: number; trackIds: string[] };
}

export function selectionClips(p: Project, selection: EditSelection): string[] {
  if (!selection.range) return selection.clipIds;
  const { start, end, trackIds } = selection.range;
  return p.tracks.filter((t) => trackIds.includes(t.id)).flatMap((t) => t.clips
    .filter((c) => c.start < end && c.start + c.length > start).map((c) => c.id));
}

export function selectedNotes(p: Project, selection: EditSelection, clipId: string): Note[] {
  for (const t of p.tracks) {
    const c = t.clips.find((c) => c.id === clipId);
    if (!c || c.type !== 'midi') continue;
    const explicit = selection.notes?.find((n) => n.clipId === c.id);
    if (explicit) {
      const ids = new Set(explicit.noteIds);
      return c.notes.filter((n) => ids.has(n.id));
    }
    const r = selection.range;
    if (r && r.trackIds.includes(t.id)) return c.notes.filter((n) =>
      c.start + n.start < r.end && c.start + n.start + n.duration > r.start);
    return selection.clipIds.includes(c.id) ? c.notes : [];
  }
  return [];
}
