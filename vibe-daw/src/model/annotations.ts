import type { Annotation, Project } from './types';
import { beatToBar, beatsToSeconds } from './project';
import type { EditSelection } from './selection';
import { selectionClips } from './selection';

export function sortedAnnotations(p: Project): Annotation[] {
  return [...(p.annotations ?? [])].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
}

export function annotationText(p: Project, a: Annotation, max = 4000): string {
  return `${a.id} ${a.kind} bars ${+beatToBar(p, a.start).toFixed(2)}–${+beatToBar(p, a.start + a.length).toFixed(2)}${a.trackId ? ` on ${a.trackId}` : ''}${a.resolved ? ' (resolved)' : ''} [${a.author}]: ${JSON.stringify(a.text.slice(0, max))}`;
}

export function selectionAnnotations(p: Project, selection: EditSelection): Annotation[] {
  const ids = new Set(selectionClips(p, selection));
  const clips = p.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)).map((c) => ({ start: c.start, end: c.start + c.length, trackIds: [t.id] })));
  const ranges = selection.range ? [selection.range] : clips;
  return sortedAnnotations(p).filter((a) => ranges.some((r) => a.start < r.end && a.start + a.length > r.start && (!a.trackId || r.trackIds.includes(a.trackId))));
}

/** LRC uses wall-clock timestamps derived from the project's fixed tempo. */
export function exportLyrics(p: Project): string {
  return sortedAnnotations(p).filter((a) => a.kind === 'lyric').flatMap((a) => {
    const cs = Math.round(beatsToSeconds(p, a.start) * 100);
    const stamp = `[${String(Math.floor(cs / 6000)).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}]`;
    return a.text.split(/\r?\n/).filter(Boolean).map((line) => stamp + line);
  }).join('\n') + '\n';
}

export function exportAnnotations(p: Project): string {
  return `${p.name} · ${p.bpm} BPM\n\n${sortedAnnotations(p).map((a) => annotationText(p, a)).join('\n\n')}\n`;
}
