import { AddToChat } from './AddToChat';
import { useMemo, useRef, useState } from 'react';
import { Play, Square, Upload, Plus, X, Bookmark } from '../icons';
import { useLibrary, addSample, searchSamples } from '../../samples/library';
import { previewSample, stopPreview } from '../../engine/api';
import { PRESETS } from '../../model/catalog';
import { useDaw, useTransport } from '../../state/store';
import { beatsPerBar, createTrack } from '../../model/project';
import type { SampleMeta } from '../../model/types';
import { toast } from '../toast';
import { importMidiFile } from '../midiActions';
import { placeSample } from '../actions';
import { openSavePreset } from './SavePreset';
import { PresetLibrary } from './PresetLibrary';
import { OnlineSounds } from './OnlineSounds';

const CATS: Array<[label: string, value: string | undefined, filter?: (m: SampleMeta) => boolean]> = [
  ['All', undefined],
  ['Drums', 'drums'],
  ['808', '808'],
  ['FX', 'fx'],
  ['Loops', undefined, (m) => m.kind === 'loop'],
  ['AI made', undefined, (m) => m.source === 'generated' || m.source === 'designed'],
  ['Online', undefined, (m) => m.source === 'online'],
  ['Yours', undefined, (m) => m.source === 'user'],
];

function guessCategory(name: string): string {
  const n = name.toLowerCase();
  const map: Array<[RegExp, string]> = [
    [/808/, '808'], [/kick|bd\b/, 'kick'], [/snare|sd\b/, 'snare'], [/clap/, 'clap'], [/open.?hat|oh\b/, 'openhat'], [/hat|hh/, 'hat'],
    [/perc|rim|shaker|conga|tom/, 'perc'], [/crash|ride|cymbal/, 'crash'], [/guitar|gtr/, 'guitar'], [/piano|keys|rhodes/, 'keys'],
    [/vox|vocal|voice/, 'vocal'], [/fx|riser|impact|sweep/, 'fx'], [/bass/, 'bass'], [/loop|melody|chords/, 'loop'],
  ];
  return map.find(([re]) => re.test(n))?.[1] ?? 'loop';
}

export async function importAudioFiles(files: FileList | File[]) {
  for (const f of Array.from(files)) {
    if (/\.midi?$/i.test(f.name) || ['audio/midi', 'audio/x-midi'].includes(f.type)) {
      try { const result = await importMidiFile(f); toast(`Imported ${result.tracks} MIDI tracks`); if (result.warnings.length) toast(result.warnings.join(' ')); }
      catch (e) { toast(`Couldn't import ${f.name}: ${(e as Error).message}`, 'error'); }
      continue;
    }
    if (!f.type.startsWith('audio/') && !/\.(wav|mp3|ogg|flac|m4a|aiff?)$/i.test(f.name)) continue;
    try {
      const data = await f.arrayBuffer();
      const bpmMatch = f.name.match(/(\d{2,3})\s?bpm/i);
      const meta = await addSample({ name: f.name.replace(/\.[^.]+$/, ''), category: guessCategory(f.name), source: 'user', bpm: bpmMatch ? Number(bpmMatch[1]) : undefined }, { data, mime: f.type || 'audio/wav' });
      toast(`Imported ${meta.name}`);
    } catch (e) {
      toast(`Couldn't import ${f.name}: ${(e as Error).message}`, 'error');
    }
  }
}

/** Add a sample without drag-and-drop (touch screens): onto the selected audio track at the playhead's bar, else a new track. */
function addSampleToTimeline(m: SampleMeta) {
  const daw = useDaw.getState();
  const bpb = beatsPerBar(daw.project);
  const beat = Math.floor(useTransport.getState().position / bpb) * bpb;
  if (placeSample(m.id, daw.selection.trackId, beat)) toast(`Added ${m.name} to the timeline`);
}

function SampleRow({ m, playing, onPlay }: { m: SampleMeta; playing: boolean; onPlay: () => void }) {
  const bits = [m.bpm ? `${m.bpm} bpm` : '', m.key ?? '', `${m.duration.toFixed(1)}s`].filter(Boolean).join(' · ');
  return (
    <div
      data-chat-ref={`sample:${m.id}`}
      className={`sample-row ${m.source === 'generated' || m.source === 'designed' ? 'generated' : ''}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-vibe-sample', m.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title={m.aiDescription ?? m.prompt ?? m.name}
    >
      <button className="play-mini" onClick={onPlay} aria-label={playing ? 'Stop preview' : `Preview ${m.name}`}>
        {playing ? <Square size={11} /> : <Play size={12} />}
      </button>
      <span className="name">{m.name}</span>
      <span className="meta">{bits}</span>
      <AddToChat referenceId={`sample:${m.id}`} label={m.name} mini />
      <button className="add-mini" onClick={() => addSampleToTimeline(m)} aria-label={`Add ${m.name} to the timeline`} title="Add to the selected audio track at the playhead, or a new track"><Plus size={13} /></button>
      <button className="add-mini" onClick={() => openSavePreset({ kind: 'sound', name: m.name, sampleId: m.id })} aria-label={`Save ${m.name} to library`} title="Save sound to your library"><Bookmark size={12} /></button>
      {m.attribution && <a className="credit" href={m.attribution.sourceUrl} target="_blank" rel="noreferrer">{m.attribution.author} · {m.attribution.license}</a>}
      {m.aiDescription && <span className="heard">{m.aiDescription}</span>}
    </div>
  );
}

export function Browser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'sounds' | 'instruments' | 'online' | 'library'>('sounds');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const samples = useLibrary((s) => s.samples);
  const update = useDaw((s) => s.update);

  const list = useMemo(() => {
    const [, category, filter] = CATS[cat];
    let res = searchSamples(query, category, 500);
    if (filter) res = res.filter(filter);
    return res;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [samples, query, cat]);

  const play = (id: string) => {
    if (playingId === id) { stopPreview(); setPlayingId(null); return; }
    setPlayingId(id);
    void previewSample(id);
    const dur = samples[id]?.duration ?? 1;
    setTimeout(() => setPlayingId((cur) => (cur === id ? null : cur)), Math.min(30, dur) * 1000);
  };

  const addInstrument = (preset: string) => {
    update('Add track', (d) => { d.tracks.push(createTrack(d, 'instrument', { preset })); });
    toast(`Added ${PRESETS.find((p) => p.id === preset)?.name ?? 'instrument'} track`);
  };

  const families = useMemo(() => {
    const m = new Map<string, typeof PRESETS>();
    for (const p of PRESETS) m.set(p.family, [...(m.get(p.family) ?? []), p]);
    return [...m];
  }, []);

  return (
    <aside className={`browser ${open ? '' : 'collapsed'}`} aria-label="Browser">
      <div className="tabs" role="tablist">
        <button className={`tab ${tab === 'sounds' ? 'active' : ''}`} onClick={() => setTab('sounds')} role="tab">Sounds</button>
        <button className={`tab ${tab === 'instruments' ? 'active' : ''}`} onClick={() => setTab('instruments')} role="tab">Instruments</button>
        <button className={`tab ${tab === 'online' ? 'active' : ''}`} onClick={() => setTab('online')} role="tab">Online</button>
        <button className={`tab ${tab === 'library' ? 'active' : ''}`} onClick={() => setTab('library')} role="tab">Library</button>
        <button className="btn icon drawer-close" onClick={onClose} aria-label="Close browser"><X size={16} /></button>
      </div>
      {tab === 'library' ? <PresetLibrary /> : tab === 'online' ? <OnlineSounds /> : tab === 'sounds' ? (
        <>
          <div className="browser-search">
            <input type="search" placeholder="Search sounds" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search sounds" />
          </div>
          <div className="cats">
            {CATS.map(([label], i) => (
              <button key={label} className={`cat ${cat === i ? 'active' : ''}`} onClick={() => setCat(i)}>{label}</button>
            ))}
          </div>
          <div className="list">
            {list.map((m) => <SampleRow key={m.id} m={m} playing={playingId === m.id} onPlay={() => play(m.id)} />)}
            {!list.length && <div className="dock-empty">No sounds match. Ask the agent to generate one.</div>}
          </div>
          <div className="browser-foot">
            <div
              className={`dropzone ${over ? 'over' : ''}`}
              onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void importAudioFiles(e.dataTransfer.files); }}
            >
              <button className="btn" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import audio / MIDI</button>
              <div>or drop files here</div>
              <input ref={fileRef} type="file" accept="audio/*,.mid,.midi" multiple hidden onChange={(e) => { if (e.target.files) void importAudioFiles(e.target.files); e.target.value = ''; }} />
            </div>
          </div>
        </>
      ) : (
        <div className="list">
          {families.map(([family, presets]) => (
            <div key={family}>
              <div className="family">{family[0].toUpperCase() + family.slice(1)}</div>
              {presets.map((p) => (
                <div
                  key={p.id}
                  className="preset-row"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('application/x-vibe-preset', p.id)}
                  onDoubleClick={() => addInstrument(p.id)}
                  title="Double-click or drag to add a track"
                >
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <b style={{ flex: 1 }}>{p.name}</b>
                    <button className="btn icon" onClick={() => addInstrument(p.id)} aria-label={`Add ${p.name} track`}><Plus size={14} /></button>
                  </div>
                  <span className="desc">{p.description}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
