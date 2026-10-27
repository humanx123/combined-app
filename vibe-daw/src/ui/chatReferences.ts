import { create } from 'zustand';
import { useDaw } from '../state/store';
import { useLibrary } from '../samples/library';
import { usePresets, presetPayload } from '../state/presetLibrary';
import { describeProject, describeSelection } from '../agent/context';
import { annotationText } from '../model/annotations';
import { cloneDeep } from '../model/project';
import { effectName } from '../model/customEffect';
import type { EditSelection } from '../model/selection';
import { toast } from './toast';

export interface ChatReference { id: string; label: string; kind: string; text: string; projectId?: string; selection?: EditSelection }
export const useChatReferences = create<{ pending: ChatReference[]; extras: ChatReference[] }>(() => ({ pending: [], extras: [] }));

/** One catalog powers @ mentions, Add to chat buttons, and context menus. */
export function chatReferenceCatalog(): Array<Omit<ChatReference, 'text'> & { text: () => string }> {
  const { project: p, selection } = useDaw.getState();
  const refs: Array<Omit<ChatReference, 'text'> & { text: () => string }> = [];
  const add = (id: string, label: string, kind: string, text: () => string, focus?: EditSelection) => refs.push({ id, label, kind, text, projectId: p.id, selection: focus });
  if (selection.clipIds.length || selection.range) add('selection', 'Current selection', 'Selection', () => describeSelection(p, selection).text, cloneDeep(selection));
  for (const t of p.tracks) {
    add(`track:${t.id}`, t.name, 'Track', () => describeProject({ ...p, tracks: [t], master: { ...p.master, effects: [] } }));
    for (const c of t.clips) add(`clip:${c.id}`, c.name, `Clip · ${t.name}`, () => describeSelection(p, { clipIds: [c.id] }).text, { clipIds: [c.id] });
    for (const e of t.effects) add(`effect:${e.id}`, `${effectName(e)} · ${t.name}`, 'Effect', () => JSON.stringify({ trackId: t.id, ...e }));
  }
  for (const e of p.master.effects) add(`effect:${e.id}`, `${effectName(e)} · Master`, 'Effect', () => JSON.stringify({ trackId: 'master', ...e }));
  for (const a of p.annotations ?? []) add(`annotation:${a.id}`, a.text.slice(0, 80), a.kind === 'lyric' ? 'Lyrics' : 'Note', () => annotationText(p, a), { clipIds: [], range: { start: a.start, end: a.start + a.length, trackIds: a.trackId ? [a.trackId] : p.tracks.map((t) => t.id) } });
  for (const s of p.sections) {
    const focus = { clipIds: [], range: { start: s.start, end: s.start + s.length, trackIds: p.tracks.map((t) => t.id) } };
    add(`section:${s.id}`, s.name, 'Section', () => JSON.stringify(s) + '\n' + describeSelection(p, focus).text, focus);
  }
  for (const s of Object.values(useLibrary.getState().samples)) refs.push({ id: `sample:${s.id}`, label: s.name, kind: 'Sample', text: () => JSON.stringify(s) });
  for (const r of Object.values(usePresets.getState().records)) if (!r.deleted) refs.push({ id: `preset:${r.id}`, label: r.name, kind: `Saved ${r.kind}`, text: () => `Library item ${r.id} (${r.kind}) ${JSON.stringify(r.name)}; tags: ${r.tags.join(', ')}. Use load_library_item to reuse.`, });
  return [...refs, ...useChatReferences.getState().extras.map((r) => ({ ...r, text: () => r.text }))];
}

export function attachChatReference(id: string) {
  const ref = chatReferenceCatalog().find((r) => r.id === id);
  if (!ref) { toast('That reference is no longer available', 'error'); return; }
  const state = useChatReferences.getState();
  if (state.pending.length >= 16 && !state.pending.some((r) => r.id === id)) { toast('Send or remove a reference before adding more', 'error'); return; }
  useChatReferences.setState({ pending: [...state.pending.filter((r) => r.id !== id), { ...ref, text: ref.text() }] });
  window.dispatchEvent(new Event('vibe:open-agent'));
}

/** Refresh project entities at send time; omit deleted or switched-project refs. */
export function resolveChatReferences(): ChatReference[] {
  const p = useDaw.getState().project, catalog = chatReferenceCatalog();
  return useChatReferences.getState().pending.flatMap((r) => {
    if (r.projectId && r.projectId !== p.id) return [];
    if (r.id === 'selection') return [{ ...r, text: describeSelection(p, r.selection!).text }]; // Preserve the attached note/range snapshot.
    const current = catalog.find((c) => c.id === r.id);
    if (!current) return [];
    if (r.id.startsWith('preset:')) {
      const record = usePresets.getState().records[r.id.slice(7)];
      try { return [{ ...current, text: current.text() + '\n' + describeProject(presetPayload(record).project) }]; } catch { return []; }
    }
    return [{ ...current, text: current.text() }];
  });
}

export function serializeChatReference(ref: ChatReference): string {
  // JSON quoting keeps user-authored labels/text data within one reference envelope.
  return `<project_reference>\n${JSON.stringify({ type: ref.kind, name: ref.label, content: ref.text.slice(0, 40000) })}\n</project_reference>`;
}
