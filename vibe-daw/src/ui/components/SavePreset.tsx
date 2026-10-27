import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Bookmark, X } from '../icons';
import type { PresetKind } from '../../model/presets';
import { usePresets } from '../../state/presetLibrary';
import { useDaw } from '../../state/store';
import { saveToLibrary } from '../presetActions';
import { toast } from '../toast';

interface SaveRequest { kind: PresetKind; name: string; trackId?: string; effectId?: string; sampleId?: string }
const dialog = create<{ request: SaveRequest | null }>(() => ({ request: null }));
export function openSavePreset(request: SaveRequest) { dialog.setState({ request }); }

export function SavePresetDialog() {
  const request = dialog((s) => s.request);
  const scope = usePresets((s) => s.scope);
  const [name, setName] = useState(''), [tags, setTags] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const close = () => { if (!busy) dialog.setState({ request: null }); };
  useEffect(() => {
    if (!request) return;
    setName(request.name); setTags(''); setError('');
    const timer = setTimeout(() => { input.current?.focus(); input.current?.select(); }, 0);
    return () => clearTimeout(timer);
  }, [request]);
  if (!request) return null;
  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError('');
    try {
      await saveToLibrary(request.kind, name, { trackId: request.trackId, effectId: request.effectId, sampleId: request.sampleId, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) });
      dialog.setState({ request: null }); toast(`Saved “${name.trim()}” to your library`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="overlay" onPointerDown={(e) => { if (e.currentTarget === e.target) close(); }}>
    <form className="modal save-preset" role="dialog" aria-modal="true" aria-label="Save to library" onSubmit={(e) => { e.preventDefault(); void submit(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
      <h2><Bookmark size={19} /> Save to library</h2>
      <p className="sub">{request.effectId ? 'Save this effect as a plugin, with its code and knob settings. It appears under Your plugins in every project.' : request.kind === 'effects' ? 'Save the whole effect chain, including settings and order.' : request.kind === 'template' ? 'Start future projects from this arrangement and sound palette.' : request.kind === 'sound' ? 'Keep this instrument, kit, sample or track sound for later.' : 'Keep the selected phrase, its sounds and track effects for another project.'}</p>
      <label className="field"><span>Name</span><input ref={input} type="text" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} required aria-label="Library item name" /></label>
      <label className="field"><span>Tags</span><input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="warm, intro, house" aria-label="Library item tags" /><small>Separate tags with commas. Up to 12 tags, 40 characters each.</small></label>
      <p className="sub">{scope.startsWith('user:') ? 'Saved on this device and synced to your account, including referenced audio.' : 'Saved on this device. Sign in, then use “Copy device library” to add these items to your account.'}</p>
      {error && <p role="alert" className="err">{error}</p>}
      <div className="modal-actions"><button type="button" className="btn" disabled={busy} onClick={close}><X size={14} /> Cancel</button><button className="btn primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save to library'}</button></div>
    </form>
  </div>;
}

export function saveSelectedClips() {
  const p = useDaw.getState().project;
  const ids = new Set(useDaw.getState().selection.clipIds);
  const clips = p.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)));
  openSavePreset({ kind: 'clip', name: clips.length === 1 ? clips[0].name : `${p.name} phrase` });
}
