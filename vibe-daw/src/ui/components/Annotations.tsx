import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { MessageSquarePlus, Plus, Pencil, Play, Check, Download } from '../icons';
import { useDaw, useTransport } from '../../state/store';
import type { Annotation, Project } from '../../model/types';
import { beatToBar, beatsPerBar, mintId } from '../../model/project';
import { exportAnnotations, exportLyrics, sortedAnnotations } from '../../model/annotations';
import { seek } from '../../engine/api';
import { downloadBlob } from '../../engine/exportFormats';
import { attachChatReference } from '../chatReferences';
import { uiZoom } from '../hooks';

interface Request { projectId: string; cue?: Annotation; kind: Annotation['kind']; start: number; length: number }
const dialog = create<{ request: Request | null }>(() => ({ request: null }));
export function openAnnotation(kind: Annotation['kind'] = 'note', cue?: Annotation, at?: number) {
  const { project, selection } = useDaw.getState();
  const start = at ?? selection.range?.start ?? useTransport.getState().position;
  dialog.setState({ request: { projectId: project.id, cue, kind: cue?.kind ?? kind, start: cue?.start ?? start, length: cue?.length ?? (selection.range ? selection.range.end - selection.range.start : beatsPerBar(project)) } });
}

export function AnnotationDialog() {
  const request = dialog((s) => s.request), project = useDaw((s) => s.project);
  const [text, setText] = useState(''), [kind, setKind] = useState<Annotation['kind']>('note');
  const [start, setStart] = useState(1), [length, setLength] = useState(1), [trackId, setTrackId] = useState(''), [resolved, setResolved] = useState(false);
  const close = () => dialog.setState({ request: null });
  useEffect(() => {
    if (!request) return;
    setText(request.cue?.text ?? ''); setKind(request.kind);
    setStart(beatToBar(project, request.start)); setLength(request.length / beatsPerBar(project));
    setTrackId(request.cue?.trackId ?? ''); setResolved(request.cue?.resolved ?? false);
  }, [request]); // Draft remains stable while playback or Producer state changes.
  useEffect(() => { if (request && request.projectId !== project.id) close(); }, [project.id, request]);
  if (!request || request.projectId !== project.id) return null;
  const cueExists = !request.cue || !!project.annotations?.some((a) => a.id === request.cue!.id);
  const hasRoom = !!request.cue || (project.annotations?.length ?? 0) < 5000;
  const valid = cueExists && hasRoom && text.trim().length > 0 && text.length <= 4000 && Number.isFinite(start) && start >= 1 && Number.isFinite(length) && length > 0 && (start - 1 + length) * beatsPerBar(project) <= 1e7;
  const save = () => {
    if (!valid) return;
    useDaw.getState().update(request.cue ? 'Edit annotation' : 'Add annotation', (d) => {
      const value = { kind, text: text.trim(), start: (start - 1) * beatsPerBar(d), length: length * beatsPerBar(d), trackId: trackId || undefined, resolved: kind === 'note' && resolved, author: 'user' as const };
      const old = request.cue && d.annotations?.find((a) => a.id === request.cue!.id);
      if (old) { Object.assign(old, value); delete old.aiPending; }
      else if ((d.annotations?.length ?? 0) < 5000) (d.annotations ??= []).push({ ...value, id: mintId(d, 'a') });
    });
    close();
  };
  return <div className="overlay" onPointerDown={(e) => { if (e.currentTarget === e.target) close(); }}>
    <form className="modal" role="dialog" aria-modal="true" aria-label="Timed note or lyrics" onSubmit={(e) => { e.preventDefault(); save(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
      <h2>{request.cue ? 'Edit' : 'Add'} note or lyrics</h2><p className="sub">Place a cue anywhere in the song. Lyric cues work without a vocal track.</p>
      <label className="field"><span>Kind</span><select aria-label="Annotation kind" value={kind} onChange={(e) => setKind(e.target.value as Annotation['kind'])}><option value="note">Production note</option><option value="lyric">Lyrics</option></select></label>
      <label className="field"><span>{kind === 'lyric' ? 'Lyrics' : 'Note'}</span><textarea autoFocus rows={5} maxLength={4000} value={text} onChange={(e) => setText(e.target.value)} aria-label="Annotation text" required /><small>{text.length}/4000 · One cue per lyric timing.</small></label>
      <div className="annotation-timing"><label className="field"><span>Start bar</span><input type="number" aria-label="Annotation start bar" min={1} step="any" value={start} onChange={(e) => setStart(e.target.valueAsNumber)} required /></label><label className="field"><span>Length in bars</span><input type="number" aria-label="Annotation length bars" min={0.001} step="any" value={length} onChange={(e) => setLength(e.target.valueAsNumber)} required /></label></div>
      <label className="field"><span>Applies to</span><select aria-label="Annotation track" value={trackId} onChange={(e) => setTrackId(e.target.value)}><option value="">Whole arrangement</option>{project.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      {kind === 'note' && <label className="toggle"><input type="checkbox" checked={resolved} onChange={(e) => setResolved(e.target.checked)} /> Resolved</label>}
      {!cueExists && <p className="err" role="alert">This cue was removed. Close the editor and add a new cue.</p>}
      {!hasRoom && <p className="err" role="alert">This project has reached its 5000 cue limit.</p>}
      <div className="modal-actions">{request.cue && <button type="button" className="btn danger" onClick={() => { useDaw.getState().update('Delete annotation', (d) => { d.annotations = d.annotations?.filter((a) => a.id !== request.cue!.id); }); close(); }}>Delete cue</button>}<div className="spacer" /><button type="button" className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!valid}>Save cue</button></div>
    </form>
  </div>;
}

export function AnnotationLane({ project, zoom, width }: { project: Project; zoom: number; width: number }) {
  return <div className="annotation-row">
    <div className="annotation-head"><button onClick={() => useDaw.getState().setBottom('notes')} title="Open all production notes and lyrics">Notes &amp; lyrics</button><div><button className="btn icon" onClick={() => openAnnotation()} aria-label="Add production note"><Plus size={13} /></button><button className="btn" onClick={() => openAnnotation('lyric')} aria-label="Add lyrics">Aa</button></div></div>
    <div className="annotation-lane" style={{ width }} onDoubleClick={(e) => { if (e.target !== e.currentTarget) return; const beat = (e.clientX - e.currentTarget.getBoundingClientRect().left) / uiZoom() / zoom; const snap = useDaw.getState().snap; const grid = snap === 0 ? beatsPerBar(project) : snap > 0 ? snap : 0.25; openAnnotation('note', undefined, Math.max(0, Math.round(beat / grid) * grid)); }}>
      {sortedAnnotations(project).map((a) => <button key={a.id} data-chat-ref={`annotation:${a.id}`} className={`annotation-cue ${a.kind} ${a.aiPending ? 'pending' : ''} ${a.resolved ? 'resolved' : ''}`} style={{ left: a.start * zoom, width: Math.max(20, a.length * zoom - 2), top: a.kind === 'lyric' ? 30 : 3 }} onClick={() => openAnnotation(a.kind, a)} title={`${a.kind === 'lyric' ? 'Lyrics' : 'Note'}: ${a.text}`} aria-label={`Edit ${a.kind}: ${a.text.slice(0, 80)}`}>{a.kind === 'lyric' ? '♫ ' : '✎ '}{a.text}</button>)}
    </div>
  </div>;
}

export function AnnotationsPanel() {
  const project = useDaw((s) => s.project), [query, setQuery] = useState(''), [filter, setFilter] = useState('all');
  const annotations = sortedAnnotations(project).filter((a) => (filter === 'all' || (filter === 'open' ? !a.resolved && a.kind === 'note' : a.kind === filter)) && a.text.toLowerCase().includes(query.toLowerCase()));
  const download = (lyrics: boolean) => downloadBlob(new Blob([lyrics ? exportLyrics(project) : exportAnnotations(project)], { type: 'text/plain;charset=utf-8' }), `${project.name.replace(/[^\w -]/g, '') || 'song'}${lyrics ? '.lrc' : '-notes.txt'}`);
  return <div className="annotations-panel">
    <div className="annotation-tools"><button className="btn" onClick={() => openAnnotation()}><Plus size={13} /> Add note</button><button className="btn" onClick={() => openAnnotation('lyric')}><Plus size={13} /> Add lyrics</button><input type="search" aria-label="Search annotations" placeholder="Search notes and lyrics" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="Filter annotations" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All cues</option><option value="open">Open notes</option><option value="note">Notes</option><option value="lyric">Lyrics</option></select><button className="btn" onClick={() => download(true)} disabled={!project.annotations?.some((a) => a.kind === 'lyric')}><Download size={12} /> Lyrics (.lrc)</button><button className="btn" onClick={() => download(false)}><Download size={12} /> Notes (.txt)</button></div>
    <div className="annotation-list">{annotations.map((a) => <article className={`annotation-item ${a.resolved ? 'resolved' : ''}`} key={a.id} data-chat-ref={`annotation:${a.id}`}>
      <div className="annotation-meta"><button className="btn" onClick={() => seek(a.start)} title="Jump to this cue"><Play size={11} /> Bar {+beatToBar(project, a.start).toFixed(2)}</button><span>{a.kind === 'lyric' ? 'Lyrics' : 'Note'} · {a.author === 'producer' ? 'Producer' : 'You'}{a.trackId ? ` · ${project.tracks.find((t) => t.id === a.trackId)?.name ?? 'removed track'}` : ''}</span></div>
      <button className="annotation-text" onClick={() => openAnnotation(a.kind, a)}>{a.text}</button>
      <div className="annotation-actions"><button className="btn" onClick={() => attachChatReference(`annotation:${a.id}`)}><MessageSquarePlus size={13} /> Add to chat</button><button className="btn" onClick={() => openAnnotation(a.kind, a)}><Pencil size={12} /> Edit cue</button>{a.kind === 'note' && <button className="btn" onClick={() => useDaw.getState().update('Resolve note', (d) => { const n = d.annotations!.find((n) => n.id === a.id)!; n.resolved = !n.resolved; delete n.aiPending; })}><Check size={12} /> {a.resolved ? 'Reopen' : 'Resolve'}</button>}</div>
    </article>)}{!annotations.length && <p className="sub">Add mix feedback, arrangement reminders or timed lyrics. Select a range first to place a cue across that section.</p>}</div>
  </div>;
}
