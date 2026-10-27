import { useEffect, useRef, useState } from 'react';
import { Search, Download, ExternalLink } from '../icons';
import { importOnlineSound, searchOnlineSounds, type OnlineSound } from '../../samples/online';
import { toast } from '../toast';

export function OnlineSounds() {
  const [query, setQuery] = useState('');
  const [sounds, setSounds] = useState<OnlineSound[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [searched, setSearched] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const download = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); download.current?.abort(); }, []);
  const search = async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    try { const found = await searchOnlineSounds(query, controller.signal); setSounds(found); setSearched(true); }
    catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const add = async (sound: OnlineSound) => {
    const controller = new AbortController(); download.current = controller;
    setImporting(sound.title);
    try { const meta = await importOnlineSound(sound.title, controller.signal); toast(`Imported ${meta.name}. Find it in Sounds → Online.`); }
    catch (e) { if (!controller.signal.aborted) toast((e as Error).message, 'error'); }
    finally { if (!controller.signal.aborted) setImporting(null); }
  };
  return <>
    <form className="browser-search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search online sounds" placeholder="Rain, birds, percussion…" />
      <button className="btn" disabled={!query.trim() || busy}><Search size={14} /> {busy ? 'Searching…' : 'Search'}</button>
    </form>
    <p className="online-caption">Explore Wikimedia Commons audio. Check each license and attribution before releasing your music. Up to 16 MB / 3 minutes per clip.</p>
    {error && <p role="alert" className="online-caption">{error}</p>}
    <div className="list">{sounds.map((sound) => <article key={sound.title} className="online-sound">
      <b>{sound.name}</b>
      <small>{sound.author} · {sound.license} · {Math.round(sound.seconds)}s</small>
      <a href={sound.sourceUrl} target="_blank" rel="noreferrer">Listen &amp; source <ExternalLink size={11} /></a>
      <button className="btn" disabled={!!importing} onClick={() => void add(sound)}><Download size={13} /> {importing === sound.title ? 'Importing…' : 'Import to library'}</button>
    </article>)}{searched && !busy && !sounds.length && <p className="online-caption">No supported audio found. Try a broader term, such as “rain” or “drum”.</p>}</div>
  </>;
}
