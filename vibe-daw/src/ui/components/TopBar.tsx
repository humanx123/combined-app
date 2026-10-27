import { useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, Repeat, Metronome, Undo2, Redo2, Settings, FolderOpen, Download, PanelLeft, PanelRight, LogIn, Cloud, Square, CircleQuestionMark, Ellipsis } from '../icons';
import { useDaw, useTransport } from '../../state/store';
import { flushAutosave, usePersist } from '../../state/persistence';
import { useAuth, signIn } from '../../cloud/cloud';
import { firebaseConfigured } from '../../cloud/config';
import { togglePlay, stop, exportAudio } from '../../engine/api';
import { EXPORT_FORMATS, downloadBlob, type ExportFormat } from '../../engine/exportFormats';
import { formatPosition } from '../../model/project';
import { projectToMidi } from '../../model/midi';
import { PITCH_CLASSES, SCALES } from '../../model/theory';
import type { PitchClass, ScaleName } from '../../model/types';
import { toast } from '../toast';
import { tip, useKeymap } from '../../state/keymap';
import { exportProjectFile } from '../../state/projectFile';
import { projectCredits } from '../../samples/credits';
import { VibeMark, Wordmark } from '../../brand/Wordmark';
import { flowSeconds, useTheme } from '../../state/theme';

function Position() {
  const ts = useDaw((s) => s.project.timeSignature);
  // The display changes at sixteenths, while the playhead moves every frame.
  const label = useTransport((s) => formatPosition({ timeSignature: ts }, s.position));
  return <div className="pos" title="Bar . beat . sixteenth">{label}</div>;
}

export function TopBar(props: { onOpenSettings: () => void; onOpenProjects: () => void; onOpenHelp: () => void; browserOpen: boolean; agentOpen: boolean; toggleBrowser: () => void; toggleAgent: () => void }) {
  useKeymap((k) => k.overrides);
  const flow = useTheme((s) => flowSeconds(s.flow));
  const name = useDaw((s) => s.project.name);
  const bpm = useDaw((s) => s.project.bpm);
  const key = useDaw((s) => s.project.key);
  const ts = useDaw((s) => s.project.timeSignature);
  const loop = useDaw((s) => s.project.loop.enabled);
  const canUndo = useDaw((s) => s.past.length > 0);
  const canRedo = useDaw((s) => s.future.length > 0);
  const update = useDaw((s) => s.update);
  const playing = useTransport((s) => s.playing);
  const starting = useTransport((s) => s.starting);
  const metronome = useTransport((s) => s.metronome);
  const saveState = usePersist((s) => s.saveState);
  const user = useAuth((s) => s.user);
  const syncing = useAuth((s) => s.syncing);
  const syncingAudio = useAuth((s) => s.syncingAudio);
  const sampleSyncError = useAuth((s) => s.sampleSyncError);
  const cloudSyncError = useAuth((s) => s.lastSyncError);
  const [bpmDraft, setBpmDraft] = useState<string | null>(null);
  const tempoInput = useRef<HTMLInputElement>(null);
  const tempoDrag = useRef<{ y: number; bpm: number; moved: boolean } | null>(null);

  const commitBpm = () => {
    if (bpmDraft === null) return;
    const v = Number(bpmDraft);
    if (isFinite(v) && v >= 40 && v <= 220) update('Tempo', (d) => { d.bpm = Math.round(v * 100) / 100; });
    setBpmDraft(null);
  };


  return (
    <header className="topbar">
      <a className="brand" href="/" onClick={(e) => {
        // Save pending edits before leaving; a page being unloaded can drop the async write.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        void flushAutosave().finally(() => { window.location.href = '/'; });
      }} title="Vibe home" aria-label="Vibe home"><VibeMark className="brand-mark" flow={flow} /><Wordmark className="brand-name" flow={flow} /></a>
      <button className="btn icon" title={tip('Show or hide the sound browser', 'toggleBrowser')} onClick={props.toggleBrowser} aria-pressed={props.browserOpen}><PanelLeft size={16} /></button>
      <input
        className="project-name"
        value={name}
        aria-label="Project name"
        onChange={(e) => update('Rename project', (d) => { d.name = e.target.value; }, { coalesce: true })}
      />
      <span className="save-state hide-narrow" title={sampleSyncError ?? cloudSyncError ?? undefined}>{sampleSyncError ? 'Audio sync failed' : cloudSyncError ? 'Cloud sync failed' : syncingAudio ? 'Syncing audio…' : saveState === 'saved' ? (user ? (syncing ? 'Syncing…' : 'Saved') : 'Saved locally') : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Edited'}</span>
      <button className="btn icon hide-narrow" title="Open, create, or delete projects" onClick={props.onOpenProjects}><FolderOpen size={16} /></button>
      <button className="btn icon" title={tip('Undo', 'undo')} disabled={!canUndo} onClick={() => useDaw.getState().undo()}><Undo2 size={16} /></button>
      <button className="btn icon" title={tip('Redo', 'redo')} disabled={!canRedo} onClick={() => useDaw.getState().redo()}><Redo2 size={16} /></button>

      {/* Phones put the transport and LCD on a second row. */}
      <div className="topbar-break" aria-hidden />

      <div className="transport">
        <button className="btn icon" title={tip('Back to start', 'stopRewind')} onClick={() => stop(true)}><SkipBack size={16} /></button>
        <button className="btn icon hide-narrow" title="Stop" onClick={() => stop(false)}><Square size={14} /></button>
        <button className={`play ${playing || starting ? 'playing' : ''}`} aria-label={starting ? 'Cancel playback startup' : playing ? 'Pause' : 'Play'} title={starting ? 'Loading audio… Click to cancel' : tip('Play / pause', 'playPause')} onClick={() => void togglePlay().catch((e) => toast(`Playback failed: ${(e as Error).message}`, 'error'))}>
          {playing || starting ? <Pause size={17} /> : <Play size={17} />}
        </button>
        {starting && <span className="transport-loading" role="status">Loading audio…</span>}
        <button className={`btn icon ${loop ? 'on' : ''}`} title={tip('Loop', 'toggleLoop')} onClick={() => update('Toggle loop', (d) => { d.loop.enabled = !d.loop.enabled; })}><Repeat size={16} /></button>
        <button className={`btn icon ${metronome ? 'on' : ''}`} title={tip('Metronome click', 'toggleMetronome')} onClick={() => useTransport.getState().setMetronome(!metronome)}><Metronome size={16} /></button>
      </div>

      <div className="lcd">
        <Position />
        {/* Drag up or down to change the tempo (Shift for tenths); a click without a drag types instead. */}
        <div
          className="tempo"
          title="Tempo · drag up or down, or click to type"
          onPointerDown={(e) => {
            if (document.activeElement === tempoInput.current) return;
            e.preventDefault();
            tempoDrag.current = { y: e.clientY, bpm, moved: false };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = tempoDrag.current;
            if (!d) return;
            const dy = d.y - e.clientY;
            if (!d.moved && Math.abs(dy) < 3) return;
            d.moved = true;
            const fine = e.shiftKey, v = Math.max(40, Math.min(220, d.bpm + dy * (fine ? 0.1 : 0.5)));
            const next = fine ? Math.round(v * 10) / 10 : Math.round(v);
            if (next !== useDaw.getState().project.bpm) update('Tempo', (p) => { p.bpm = next; }, { coalesce: true });
          }}
          onPointerUp={() => {
            const d = tempoDrag.current;
            tempoDrag.current = null;
            if (d && !d.moved) { tempoInput.current?.focus(); tempoInput.current?.select(); }
          }}
          onPointerCancel={() => { tempoDrag.current = null; }}
        >
          <input
            ref={tempoInput}
            aria-label="Tempo"
            value={bpmDraft ?? String(bpm)}
            onChange={(e) => setBpmDraft(e.target.value)}
            onBlur={commitBpm}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setBpmDraft(null); }}
          />
          <span className="unit">BPM</span>
        </div>
        <div title="Key">
          <select aria-label="Key root" value={key.root} onChange={(e) => update('Key', (d) => { d.key.root = e.target.value as PitchClass; })}>
            {PITCH_CLASSES.map((pc) => <option key={pc} value={pc}>{pc}</option>)}
          </select>
          &nbsp;
          <select aria-label="Scale" value={key.scale} onChange={(e) => update('Scale', (d) => { d.key.scale = e.target.value as ScaleName; })}>
            {Object.keys(SCALES).map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
          </select>
        </div>
        <div className="sig" title="Time signature">
          <select aria-label="Time signature" value={ts.join('/')} onChange={(e) => update('Time signature', (d) => { d.timeSignature = e.target.value.split('/').map(Number) as [number, number]; })}>
            {['4/4', '3/4', '6/8', '5/4', '7/8'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="top-right">
        <ExportMenu />
        {firebaseConfigured && (user ? (
          <span className="avatar" title={`${user.name ?? user.email} - synced to the cloud`}>
            {user.photo ? <img src={user.photo} alt="" referrerPolicy="no-referrer" /> : (user.name ?? '?')[0]}
          </span>
        ) : (
          <button className="btn hide-narrow" onClick={() => signIn().catch((e) => toast(e.message, 'error'))} title="Sign in to sync projects and samples"><LogIn size={15} /> Sign in</button>
        ))}
        {user && <Cloud size={14} color="var(--faint)" aria-label="Cloud sync on" />}
        <button className="btn icon hide-narrow" title={tip('Help and keyboard shortcuts', 'help')} onClick={props.onOpenHelp}><CircleQuestionMark size={16} /></button>
        <button className="btn icon hide-narrow" title="Settings: Gemini key, model, account" onClick={props.onOpenSettings}><Settings size={16} /></button>
        <MoreMenu onOpenProjects={props.onOpenProjects} onOpenHelp={props.onOpenHelp} onOpenSettings={props.onOpenSettings} signedIn={!!user} />
        <button className="btn icon" title={tip('Show or hide the Producer panel', 'toggleAgent')} onClick={props.toggleAgent} aria-pressed={props.agentOpen}><PanelRight size={16} /></button>
      </div>
    </header>
  );
}

/** Open/close state for a dropdown that closes on any press outside it. */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return { open, setOpen, ref };
}

/** Narrow-screen overflow menu for the actions that don't fit in the top bar. */
function MoreMenu(props: { onOpenProjects: () => void; onOpenHelp: () => void; onOpenSettings: () => void; signedIn: boolean }) {
  const { open, setOpen, ref } = useDropdown();
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="menu-wrap only-narrow" ref={ref}>
      <button className="btn icon" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label="More"><Ellipsis size={16} /></button>
      {open && (
        <div className="menu" role="menu">
          <button className="menu-item" role="menuitem" onClick={pick(props.onOpenProjects)}><b><FolderOpen size={14} /> Projects</b><span>Open, create, or delete projects</span></button>
          {firebaseConfigured && !props.signedIn && (
            <button className="menu-item" role="menuitem" onClick={pick(() => void signIn().catch((e) => toast(e.message, 'error')))}><b><LogIn size={14} /> Sign in</b><span>Sync projects and samples</span></button>
          )}
          <button className="menu-item" role="menuitem" onClick={pick(props.onOpenSettings)}><b><Settings size={14} /> Settings</b><span>Gemini key, model, theme, playback</span></button>
          <button className="menu-item" role="menuitem" onClick={pick(props.onOpenHelp)}><b><CircleQuestionMark size={14} /> Help</b><span>How Vibe works</span></button>
        </div>
      )}
    </div>
  );
}

function ExportMenu() {
  const { open, setOpen, ref } = useDropdown();
  const [progress, setProgress] = useState<{ pct: number; stage: 'render' | 'encode' } | null>(null);

  const run = async (format: ExportFormat) => {
    setOpen(false);
    setProgress({ pct: 0, stage: 'render' });
    try {
      const p = useDaw.getState().project;
      const blob = format === 'midi'
        ? new Blob([projectToMidi(p) as BlobPart], { type: 'audio/midi' })
        : await exportAudio(p, format, (f, stage) => setProgress({ pct: Math.round(f * 100), stage }));
      const ext = EXPORT_FORMATS.find((x) => x.id === format)!.ext;
      downloadBlob(blob, `${p.name.replace(/[^\w\- ]+/g, '').trim() || 'beat'}.${ext}`);
      toast(format === 'midi' ? 'Exported MIDI' : `Exported ${ext.toUpperCase()} (${(blob.size / 1048576).toFixed(1)} MB)`);
    } catch (e) {
      toast(`Export failed: ${(e as Error).message}`, 'error');
    } finally {
      setProgress(null);
    }
  };
  const saveProject = async () => {
    setOpen(false);
    setProgress({ pct: 0, stage: 'encode' });
    try {
      const p = useDaw.getState().project;
      const blob = await exportProjectFile(p);
      downloadBlob(blob, `${p.name.replace(/[^\w\- ]+/g, '').trim() || 'project'}.vibe`);
      toast(`Exported project with custom samples (${(blob.size / 1048576).toFixed(1)} MB)`);
    } catch (e) { toast(`Project export failed: ${(e as Error).message}`, 'error'); }
    finally { setProgress(null); }
  };

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)} disabled={!!progress} aria-haspopup="menu" aria-expanded={open} aria-label="Export" title="Bounce the song to an audio file">
        <Download size={15} /> {progress ? `${progress.stage === 'render' ? 'Bouncing' : 'Encoding'} ${progress.pct}%` : <span className="btn-label">Export</span>}
      </button>
      {open && (
        <div className="menu" role="menu">
          <button className="menu-item" role="menuitem" onClick={() => void saveProject()}><b>Vibe project (.vibe)</b><span>Portable session with notes, instruments, effects and custom samples</span></button>
          <button className="menu-item" role="menuitem" onClick={() => {
            const p = useDaw.getState().project; setOpen(false);
            downloadBlob(new Blob([projectCredits(p)], { type: 'text/plain' }), `${p.name.replace(/[^\w\- ]+/g, '').trim() || 'project'}-credits.txt`);
          }}><b>Sound credits (.txt)</b><span>Authors, licenses and sources for online audio and sampled instruments</span></button>
          {EXPORT_FORMATS.map((f) => (
            <button key={f.id} className="menu-item" role="menuitem" onClick={() => void run(f.id)}>
              <b>{f.label}</b>
              <span>{f.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
