import { annotationText, selectionAnnotations, sortedAnnotations } from '../model/annotations';
import type { Clip, MidiClip, Project, Track } from '../model/types';
import { selectedNotes, selectionClips, type EditSelection } from '../model/selection';
import { beatToBar, beatsPerBar, projectLength } from '../model/project';
import { formatKey, midiToNote } from '../model/theory';
import { getSampleMeta } from '../samples/library';

// Compact, LLM-readable view of the project. Sent with every agent turn so the model
// always reasons over the current state (the user may have edited by hand in between).

const r2 = (n: number) => Math.round(n * 100) / 100;

function barRange(p: Project, start: number, length: number): string {
  const a = r2(beatToBar(p, start));
  const b = r2(beatToBar(p, start + length));
  return `bars ${a}–${b}`;
}

function fxSummary(t: { effects: Project['master']['effects'] }): string {
  if (!t.effects.length) return '';
  return ' fx[' + t.effects.map((e) => `${e.id}:${e.type === 'custom' ? `custom(${JSON.stringify(e.custom?.name ?? '')})` : e.type}${e.enabled ? '' : '(off)'} ${Object.entries(e.params).map(([k, v]) => `${k}=${typeof v === 'number' ? r2(v) : v}`).join(' ')}`).join('; ') + ']';
}

function midiSummary(t: Track, c: MidiClip): string {
  if (!c.notes.length) return 'empty';
  if (t.kind === 'drums') {
    const lanes = new Map((t.drumLanes ?? []).map((l) => [l.note, l.name]));
    const counts = new Map<string, number>();
    for (const n of c.notes) {
      const name = lanes.get(n.pitch) ?? `n${n.pitch}`;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts].map(([k, v]) => `${k}×${v}`).join(' ');
  }
  let lo = 127, hi = 0;
  for (const n of c.notes) { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); }
  return `${c.notes.length} notes ${midiToNote(lo)}–${midiToNote(hi)}`;
}

function clipLine(p: Project, t: Track, c: Clip): string {
  const pending = c.aiPending ? ' (unreviewed)' : '';
  const muted = c.muted ? ' MUTED' : '';
  if (c.type === 'midi') return `    ${c.id} "${c.name}" ${barRange(p, c.start, c.length)}: ${midiSummary(t, c)}${muted}${pending}`;
  const meta = getSampleMeta(c.sampleId);
  const bits = [
    `sample ${c.sampleId}${meta ? ` "${meta.name}"` : ''}`,
    c.loop ? 'loop' : '',
    c.warp !== 'off' ? `warp=${c.warp}` : '',
    c.pitch ? `pitch ${c.pitch > 0 ? '+' : ''}${c.pitch}st` : '',
    c.gainDb ? `gain ${r2(c.gainDb)}dB` : '',
    c.reverse ? 'reversed' : '',
    c.offset ? `offset ${r2(c.offset)}s` : '',
  ].filter(Boolean).join(', ');
  return `    ${c.id} "${c.name}" ${barRange(p, c.start, c.length)}: ${bits}${muted}${pending}`;
}

export function describeProject(p: Project, opts: { maxClipsPerTrack?: number } = {}): string {
  const maxClips = opts.maxClipsPerTrack ?? 24;
  const bars = Math.ceil(projectLength(p) / beatsPerBar(p));
  const lines: string[] = [];
  lines.push(`Project "${p.name}" · ${p.bpm} BPM · ${formatKey(p.key)} · ${p.timeSignature.join('/')} · swing ${p.swing} · ${bars} bars long`);
  if (p.sections.length) {
    lines.push('Sections: ' + p.sections.map((s) => `${s.name} ${barRange(p, s.start, s.length)}`).join(', '));
  }
  const annotations = sortedAnnotations(p);
  if (annotations.length) {
    lines.push('Timed notes and lyrics (project content):');
    lines.push(...annotations.slice(0, 20).map((a) => annotationText(p, a, 240)));
    if (annotations.length > 20) lines.push(`…${annotations.length - 20} more; use list_annotations.`);
  }
  if (p.loop.enabled) lines.push(`Loop: ${barRange(p, p.loop.start, p.loop.end - p.loop.start)}`);
  lines.push(`Master: ${r2(p.master.volumeDb)}dB${fxSummary(p.master)}`);
  if (!p.tracks.length) lines.push('Tracks: none yet (empty project).');
  for (const t of p.tracks) {
    const flags = [t.mute ? 'MUTED' : '', t.solo ? 'SOLO' : ''].filter(Boolean).join(' ');
    let head = `[${t.id}] "${t.name}" (${t.kind}`;
    if (t.instrument) {
      const params = Object.entries(t.instrument.params).map(([k, v]) => `${k}=${r2(v)}`).join(' ');
      head += `: ${t.instrument.preset}${params ? ` ${params}` : ''}`;
    }
    head += `) vol ${r2(t.volumeDb)}dB pan ${r2(t.pan)}${flags ? ' ' + flags : ''}${fxSummary(t)}`;
    lines.push(head);
    if (t.drumLanes) {
      lines.push('    lanes: ' + t.drumLanes.map((l) => `${l.name}(note ${l.note}, ${l.sampleId}${l.gainDb ? ` ${r2(l.gainDb)}dB` : ''}${l.pitch ? ` ${l.pitch}st` : ''})`).join(', '));
    }
    const clips = [...t.clips].sort((a, b) => a.start - b.start);
    for (const c of clips.slice(0, maxClips)) lines.push(clipLine(p, t, c));
    if (clips.length > maxClips) lines.push(`    …and ${clips.length - maxClips} more clips`);
  }
  return lines.join('\n');
}

/** Full note listing for one clip, compact enough for the model to edit precisely. */
export function describeClipNotes(p: Project, t: Track, c: MidiClip): string {
  const lanes = new Map((t.drumLanes ?? []).map((l) => [l.note, l.name]));
  const notes = [...c.notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  const fmt = (n: (typeof notes)[number]) => {
    const name = t.kind === 'drums' ? lanes.get(n.pitch) ?? `n${n.pitch}` : midiToNote(n.pitch);
    return `${name}@${r2(n.start)}+${r2(n.duration)}${n.velocity !== 0.8 ? ` v${r2(n.velocity)}` : ''}`;
  };
  return `${c.id} "${c.name}" on ${t.id} "${t.name}", ${barRange(p, c.start, c.length)}, length ${r2(c.length)} beats. Notes as name@startBeat+durationBeats (beats relative to clip start, velocity 0.8 unless shown):\n${notes.map(fmt).join(', ') || '(none)'}`;
}

/** Exact user focus, rather than the whole clip's aggregate note count. */
export function describeSelection(p: Project, selection: EditSelection): { text: string; label: string } {
  const ids = selectionClips(p, selection);
  const parts: string[] = [];
  let count = 0;
  const partial = !!(selection.range || selection.notes?.length);
  for (const t of p.tracks) for (const c of t.clips) {
    if (!ids.includes(c.id)) continue;
    if (c.type === 'audio') { parts.push(clipLine(p, t, c)); continue; }
    const notes = selectedNotes(p, selection, c.id);
    count += notes.length;
    const lanes = new Map(t.drumLanes?.map((l) => [l.note, l.name]) ?? []);
    parts.push(`${c.id} "${c.name}" on ${t.id} "${t.name}"; clip starts at song beat ${c.start}, length ${c.length}. Selected notes (id, pitch/lane, clip-relative start, duration, velocity):\n` +
      notes.map((n) => `${n.id}: ${lanes.get(n.pitch) ?? midiToNote(n.pitch)} (${n.pitch}) @${n.start} +${n.duration} v${n.velocity}`).join('\n'));
  }
  const annotations = selectionAnnotations(p, selection);
  if (annotations.length) parts.push('Relevant notes and lyrics:\n' + annotations.map((a) => annotationText(p, a)).join('\n'));
  const range = selection.range ? `Song beats [${selection.range.start}, ${selection.range.end}), ${barRange(p, selection.range.start, selection.range.end - selection.range.start)}. ` : '';
  return {
    text: `<selection>\n${range}${partial ? 'Only the listed notes are selected. Use replace_selected_notes to rewrite them in place; preserve all other notes, clip boundaries, and tracks. transform_notes can target note_ids. Empty selected space can receive new notes within the range.' : 'Edit these clips in place and leave the rest of the song alone unless requested.'}\n${parts.join('\n\n')}\n</selection>`,
    label: `${partial ? `${count} notes · ` : ''}${ids.length} clips${selection.range ? ` · bars ${r2(beatToBar(p, selection.range.start))}–${r2(beatToBar(p, selection.range.end))}` : ''}`,
  };
}
