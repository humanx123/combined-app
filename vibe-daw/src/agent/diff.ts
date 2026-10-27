import type { Clip, Project } from '../model/types';
import { formatKey } from '../model/theory';
import { effectName } from '../model/customEffect';

// Human-readable summary of what changed between two project versions:
// the DAW equivalent of a code diff, shown under every agent run.

export interface ChangeSummary {
  lines: string[];
  added: number;
  removed: number;
  modified: number;
}

function clipSig(c: Clip): string {
  return JSON.stringify({ ...c, aiPending: undefined, notes: c.type === 'midi' ? c.notes.map((n) => [n.pitch, n.start, n.duration, n.velocity]) : undefined });
}

export function diffProjects(before: Project, after: Project): ChangeSummary {
  const lines: string[] = [];
  let added = 0, removed = 0, modified = 0;
  if (before === after) return { lines, added, removed, modified };
  if (before.bpm !== after.bpm) { lines.push(`Tempo ${before.bpm} → ${after.bpm} BPM`); modified++; }
  if (formatKey(before.key) !== formatKey(after.key)) { lines.push(`Key ${formatKey(before.key)} → ${formatKey(after.key)}`); modified++; }
  if (before.swing !== after.swing) { lines.push(`Swing ${before.swing} → ${after.swing}`); modified++; }
  if (before.name !== after.name) lines.push(`Renamed to “${after.name}”`);

  const beforeTracks = new Map(before.tracks.map((t) => [t.id, t]));
  const afterTracks = new Map(after.tracks.map((t) => [t.id, t]));
  for (const t of after.tracks) {
    const old = beforeTracks.get(t.id);
    if (!old) {
      added++;
      lines.push(`+ ${t.name} (${t.instrument?.preset ?? t.kind}) with ${t.clips.length} clip${t.clips.length === 1 ? '' : 's'}${t.effects.length ? `, ${t.effects.map((e) => effectName(e)).join(', ')}` : ''}`);
      continue;
    }
    if (old === t) continue;
    const bits: string[] = [];
    if (old.name !== t.name) bits.push(`renamed from “${old.name}”`);
    if (old.instrument?.preset !== t.instrument?.preset) bits.push(`now ${t.instrument?.preset}`);
    else if (old.instrument?.params !== t.instrument?.params) bits.push('sound tweaked');
    if (old.volumeDb !== t.volumeDb) bits.push(`${old.volumeDb} → ${t.volumeDb} dB`);
    if (old.pan !== t.pan) bits.push(`pan ${t.pan}`);
    if (old.mute !== t.mute) bits.push(t.mute ? 'muted' : 'unmuted');
    if (old.drumLanes !== t.drumLanes) bits.push('kit changed');
    const oldFx = new Set(old.effects.map((e) => e.id));
    const newFx = t.effects.filter((e) => !oldFx.has(e.id));
    if (newFx.length) bits.push(`+${newFx.map((e) => effectName(e)).join(', ')}`);
    const goneFx = old.effects.filter((e) => !t.effects.some((x) => x.id === e.id));
    if (goneFx.length) bits.push(`−${goneFx.map((e) => effectName(e)).join(', ')}`);
    else if (!newFx.length && old.effects !== t.effects) bits.push('effects tweaked');
    if (old.clips !== t.clips) {
      const oldClips = new Map(old.clips.map((c) => [c.id, clipSig(c)]));
      const newIds = new Set(t.clips.map((c) => c.id));
      const ca = t.clips.filter((c) => !oldClips.has(c.id)).length;
      const cr = old.clips.filter((c) => !newIds.has(c.id)).length;
      const cm = t.clips.filter((c) => oldClips.has(c.id) && oldClips.get(c.id) !== clipSig(c)).length;
      const parts = [ca ? `+${ca} clip${ca > 1 ? 's' : ''}` : '', cr ? `−${cr}` : '', cm ? `~${cm} edited` : ''].filter(Boolean);
      if (parts.length) bits.push(parts.join(' '));
    }
    if (bits.length) { modified++; lines.push(`~ ${t.name}: ${bits.join(', ')}`); }
  }
  for (const t of before.tracks) {
    if (!afterTracks.has(t.id)) { removed++; lines.push(`− ${t.name}`); }
  }
  const oldAnnotations = new Map((before.annotations ?? []).map((a) => [a.id, a]));
  for (const a of after.annotations ?? []) {
    const old = oldAnnotations.get(a.id);
    if (!old) { added++; lines.push(`+ ${a.kind === 'lyric' ? 'Lyrics' : 'Note'}: ${a.text.slice(0, 100)}`); }
    else if (JSON.stringify({ ...old, aiPending: undefined }) !== JSON.stringify({ ...a, aiPending: undefined })) { modified++; lines.push(`~ ${a.kind === 'lyric' ? 'Lyrics' : 'Note'}: ${a.text.slice(0, 100)}`); }
    oldAnnotations.delete(a.id);
  }
  for (const a of oldAnnotations.values()) { removed++; lines.push(`− ${a.kind === 'lyric' ? 'Lyrics' : 'Note'}: ${a.text.slice(0, 100)}`); }
  if (before.sections !== after.sections && after.sections.length) lines.push(`Sections: ${after.sections.map((s) => s.name).join(' → ')}`);
  if (before.master !== after.master) { lines.push('~ Master bus'); modified++; }
  return { lines, added, removed, modified };
}
