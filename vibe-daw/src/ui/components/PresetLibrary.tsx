import { AddToChat } from './AddToChat';
import { useState } from 'react';
import { Bookmark, Cloud, Plus, Pencil, Trash, RotateCcw } from '../icons';
import { usePresets, editPreset, copyDevicePresetsToAccount, type PresetRecord } from '../../state/presetLibrary';
import { useDaw } from '../../state/store';
import { useAuth, signIn } from '../../cloud/cloud';
import { firebaseConfigured } from '../../cloud/config';
import { retryPresetSync } from '../../cloud/presetSync';
import { loadFromLibrary } from '../presetActions';
import { openSavePreset, saveSelectedClips } from './SavePreset';
import { toast } from '../toast';

const labels = { clip: 'Clip', sound: 'Sound', effects: 'Effects', template: 'Template' };
function PresetItem({ record }: { record: PresetRecord }) {
  const trackId = useDaw((s) => s.selection.trackId);
  const [busy, setBusy] = useState(false), [renaming, setRenaming] = useState(false), [name, setName] = useState(record.name);
  const run = async (targetTrackId?: string, replaceEffects = false) => {
    setBusy(true);
    try { await loadFromLibrary(record, { targetTrackId, replaceEffects }); toast(`Loaded “${record.name}”`); }
    catch (e) { toast((e as Error).message, 'error'); }
    finally { setBusy(false); }
  };
  return <article data-chat-ref={`preset:${record.id}`} className="library-item" aria-label={`${labels[record.kind]}: ${record.name}`}>
    <div className="library-item-title"><Bookmark size={13} /><b>{record.name}</b><span>{labels[record.kind]}</span></div>
    {record.tags.length > 0 && <small className="library-tags">{record.tags.join(' · ')}</small>}
    {renaming && <form className="library-rename" onSubmit={(e) => { e.preventDefault(); void editPreset(record.id, { name: name.trim() }).then(() => setRenaming(false)).catch((e) => toast(e.message, 'error')); }}><input type="text" value={name} maxLength={120} aria-label={`Rename ${record.name}`} onChange={(e) => setName(e.target.value)} /><button className="btn">Save name</button></form>}
    <div className="library-item-actions">
      <AddToChat referenceId={`preset:${record.id}`} label={record.name} />
      {record.kind === 'effects' ? <>
        <button className="btn" disabled={busy} onClick={() => void run(trackId ?? 'master')}><Plus size={12} /> Add FX to {trackId ? 'track' : 'master'}</button>
        <button className="btn" disabled={busy} onClick={() => void run(trackId ?? 'master', true)}>Replace FX</button>
      </> : <>
        <button className="btn" disabled={busy} onClick={() => void run()}><Plus size={12} /> {record.kind === 'template' ? 'New project' : 'Add as new track'}</button>
        {record.kind !== 'template' && <button className="btn" disabled={busy || !trackId} onClick={() => void run(trackId!)}>Use selected track</button>}
      </>}
      <button className="btn icon" onClick={() => { setName(record.name); setRenaming((v) => !v); }} title="Rename library item" aria-label={`Rename ${record.name}`}><Pencil size={12} /></button>
      <button className="btn icon danger" title="Delete library item" aria-label={`Delete ${record.name}`} onClick={() => { if (confirm(`Delete “${record.name}” from your library on all devices?`)) void editPreset(record.id, { deleted: true }).catch((e) => toast(e.message, 'error')); }}><Trash size={12} /></button>
    </div>
  </article>;
}

export function PresetLibrary() {
  const library = usePresets();
  const user = useAuth((s) => s.user);
  const selected = useDaw((s) => s.selection);
  const project = useDaw((s) => s.project);
  const [query, setQuery] = useState(''), [kind, setKind] = useState('all');
  const items = Object.values(library.records).filter((r) => !r.deleted && (kind === 'all' || r.kind === kind) && `${r.name} ${r.kind} ${r.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase())).sort((a, b) => b.updatedAt - a.updatedAt);
  return <>
    <div className="browser-search"><input type="search" placeholder="Search your library" aria-label="Search your library" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    <div className="cats">{['all', 'clip', 'sound', 'effects', 'template'].map((k) => <button key={k} className={`cat ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>{k === 'all' ? 'All' : labels[k as keyof typeof labels]}</button>)}</div>
    <div className="library-status" role="status"><Cloud size={12} />{!library.ready ? 'Opening library…' : library.scope.startsWith('user:') ? library.syncing || library.dirty.length ? 'Saved locally · syncing to account…' : 'Account library' : 'Device library · available offline'}</div>
    {library.error && <div className="online-caption" role="alert">{library.error}<button className="btn" onClick={retryPresetSync}><RotateCcw size={12} /> Retry sync</button></div>}
    <div className="list">{items.map((r) => <PresetItem key={r.id} record={r} />)}{library.ready && !items.length && <div className="dock-empty">Save a phrase, sound, effect chain or template to build your palette.</div>}</div>
    <div className="library-save-actions">
      <button className="btn" disabled={!selected.clipIds.length || !library.ready} onClick={saveSelectedClips}><Bookmark size={12} /> Save selected clips</button>
      <button className="btn" disabled={!library.ready} onClick={() => openSavePreset({ kind: 'template', name: project.name })}>Save project template</button>
      {user && <button className="btn" disabled={!library.ready} onClick={() => void copyDevicePresetsToAccount().then((n) => toast(`Copied ${n} device library items to your account`)).catch((e) => toast(e.message, 'error'))}>Copy device library</button>}
      {!user && firebaseConfigured && <button className="btn" onClick={() => void signIn().catch((e) => toast(e.message, 'error'))}>Sign in to sync your library</button>}
    </div>
  </>;
}
