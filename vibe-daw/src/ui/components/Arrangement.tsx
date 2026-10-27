import { AddToChat } from './AddToChat';
import { createPortal } from 'react-dom';
import { memo, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ZoomIn, ZoomOut, Plus, Drum, Piano, AudioLines, Trash, X, Copy, CopyPlus, ClipboardPaste, Scissors } from '../icons';
import { useDaw, useTransport } from '../../state/store';
import { beatsPerBar, cloneDeep, createMidiClip, createTrack, projectLength } from '../../model/project';
import { PRESET_BY_ID } from '../../model/catalog';
import type { AudioClip, Clip, MidiClip, Project, Track } from '../../model/types';
import { seek, stop, play } from '../../engine/api';
import { getSampleMeta } from '../../samples/library';
import { audioClipRate, repeatNotes } from '../../model/edit';
import { PHONE, uiZoom, usePeaks, useMediaQuery } from '../hooks';
import { Dropdown } from './Dropdown';
import { AnnotationLane } from './Annotations';
import { attachChatReference } from '../chatReferences';
import { MessageSquarePlus } from '../icons';
import { saveSelectedClips } from './SavePreset';
import { openInlineAI } from './InlineAI';
import { MousePointer2, Bookmark } from '../icons';
import { aiAvailable, useSettings } from '../../state/settings';
import { tip, useKeymap } from '../../state/keymap';
import { toast } from '../toast';
import { useTheme } from '../../state/theme';
import { addTrack as addTrackAction, copySelectedClips, deleteSelectedClips, duplicateSelectedClips, newClipOnSelectedTrack, pasteClips, placeSample, splitAtPlayhead } from '../actions';
import {isNativeApp} from '../../native/native-bridge';

const HEADER_W = 200;
const HEADER_W_PHONE = 124;
const TRACK_H = 68;

const SNAPS: Array<[string, number]> = [['Bar', 0], ['1/4', 1], ['1/8', 0.5], ['1/16', 0.25], ['Off', -1]];

function snapBeat(beat: number, snap: number, bpb: number) {
  const grid = snap === 0 ? bpb : snap;
  if (grid < 0) return beat;
  return Math.round(beat / grid) * grid;
}

// ---------------------------------------------------------------- clip bodies

const MidiBody = memo(function MidiBody({ notes, length, kind, drumLanes }: { notes: MidiClip['notes']; length: number; kind: Track['kind']; drumLanes: Track['drumLanes'] }) {
  if (!notes.length) return null;
  if (kind === 'drums') {
    const lanes = drumLanes ?? [];
    const idx = new Map(lanes.map((l, i) => [l.note, i]));
    const rows = Math.max(1, lanes.length);
    return (
      <svg viewBox={`0 0 ${length} ${rows}`} preserveAspectRatio="none" aria-hidden>
        {notes.map((n) => {
          const r = idx.get(n.pitch);
          if (r === undefined || n.start >= length) return null;
          return <rect key={n.id} x={n.start} y={r + 0.15} width={Math.min(0.12, length / 64)} height={0.7} fill="rgba(255,255,255,0.75)" opacity={0.4 + n.velocity * 0.6} />;
        })}
      </svg>
    );
  }
  let lo = 127, hi = 0;
  for (const n of notes) { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); }
  const span = Math.max(12, hi - lo + 3);
  const top = hi + 2;
  return (
    <svg viewBox={`0 0 ${length} ${span}`} preserveAspectRatio="none" aria-hidden>
      {notes.map((n) => (n.start < length ? <rect key={n.id} x={n.start} y={top - n.pitch - 1} width={Math.max(0.05, Math.min(n.duration, length - n.start))} height={0.9} rx={0.08} fill="rgba(255,255,255,0.82)" /> : null))}
    </svg>
  );
});

function AudioBody({ clip, project, widthPx }: { clip: AudioClip; project: Project; widthPx: number }) {
  const peaks = usePeaks(clip.sampleId, clip.reverse);
  const ref = useRef<HTMLCanvasElement>(null);
  const meta = getSampleMeta(clip.sampleId);
  const theme = useTheme((s) => s.theme);
  const rate = audioClipRate(project, clip, meta?.bpm);
  const { length, offset, loop, gainDb } = clip;
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv || !peaks || !meta) return;
    const w = Math.min(4096, Math.max(1, Math.round(widthPx)));
    const h = TRACK_H - 22;
    cv.width = w * devicePixelRatio;
    cv.height = h * devicePixelRatio;
    const g = cv.getContext('2d')!;
    g.scale(devicePixelRatio, devicePixelRatio);
    g.fillStyle = getComputedStyle(cv).color; // --clip-ink, via .clip > canvas
    const secPerPx = ((length * 60) / project.bpm / w) * rate;
    const dur = meta.duration;
    const gain = Math.pow(10, gainDb / 20);
    for (let x = 0; x < w; x++) {
      let t = offset + x * secPerPx;
      if (loop && dur > 0) t = t % dur;
      if (t >= dur) break;
      const idx = Math.floor((t / dur) * peaks.length);
      const v = peaks[Math.min(peaks.length - 1, idx)] * (h / 2 - 1) * gain;
      g.fillRect(x, h / 2 - v, 1, Math.max(1, v * 2));
    }
  }, [peaks, widthPx, length, offset, loop, gainDb, rate, project.bpm, meta, theme]);
  if (!meta) return null;
  return <canvas ref={ref} aria-hidden />;
}

// ---------------------------------------------------------------- clip

function ClipView({ clip, track, project, zoom, selected, onPointerDown, onDoubleClick }: {
  clip: Clip; track: Track; project: Project; zoom: number; selected: boolean;
  onPointerDown: (e: RPointerEvent, mode: 'move' | 'resize') => void;
  onDoubleClick: () => void;
}) {
  const w = clip.length * zoom;
  return (
    <div
      data-chat-ref={`clip:${clip.id}`}
      className={`clip ${selected ? 'selected' : ''} ${clip.muted ? 'muted' : ''} ${clip.aiPending ? 'ai' : ''}`}
      style={{ left: clip.start * zoom, width: Math.max(4, w), ['--c' as string]: track.color }}
      onPointerDown={(e) => onPointerDown(e, 'move')}
      onDoubleClick={onDoubleClick}
      title={`${clip.name}${clip.aiPending ? ' - made by the agent (not reviewed yet)' : ''} · drag to move, drag the right edge to resize (Shift = fine), double-click to edit`}
    >
      <div className="cname"><span>{clip.name}</span>{selected && <AddToChat referenceId={`clip:${clip.id}`} label={clip.name} mini />}</div>
      {clip.type === 'midi' ? <MidiBody notes={clip.notes} length={clip.length} kind={track.kind} drumLanes={track.drumLanes} /> : <AudioBody clip={clip} project={project} widthPx={w} />}
      <div className="resize" onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, 'resize'); }} />
    </div>
  );
}

// ---------------------------------------------------------------- ruler

function Ruler({ project, zoom, width }: { project: Project; zoom: number; width: number }) {
  const bpb = beatsPerBar(project);
  const bars = Math.ceil(width / zoom / bpb);
  const update = useDaw((s) => s.update);
  const snap = useDaw((s) => s.snap);
  const every = zoom * bpb < 26 ? 4 : zoom * bpb < 50 ? 2 : 1;
  const loopRef = useRef<{ startBeat: number } | null>(null);

  const beatAt = (e: RPointerEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return Math.max(0, (e.clientX - rect.left) / uiZoom() / zoom);
  };

  return (
    <div className="ruler">
      <div className="corner">
        <span className="chip">{project.tracks.length} tracks</span>
      </div>
      <div
        className="marks"
        style={{ width }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          const b = beatAt(e);
          if (e.shiftKey) {
            const s = snapBeat(b, snap === -1 ? 0 : snap, bpb);
            loopRef.current = { startBeat: s };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          } else {
            scrub(e, (ev) => beatAt(ev as unknown as RPointerEvent), bpb);
          }
        }}
        onPointerMove={(e) => {
          if (!loopRef.current) return;
          const b = snapBeat(beatAt(e), snap <= 0 ? bpb : snap, bpb);
          const a = loopRef.current.startBeat;
          if (Math.abs(b - a) < 0.25) return;
          update('Set loop', (d) => { d.loop = { enabled: true, start: Math.min(a, b), end: Math.max(a, b) }; }, { coalesce: true });
        }}
        onPointerUp={() => { loopRef.current = null; }}
        title="Click or drag to move the playhead · Shift-drag to set the loop"
      >
        {Array.from({ length: bars + 1 }, (_, i) => (
          <div key={i}>
            <div className="bar-tick" style={{ left: i * bpb * zoom }} />
            {i % every === 0 && <div className="bar-num" style={{ left: i * bpb * zoom }}>{i + 1}</div>}
          </div>
        ))}
        {project.sections.map((s) => (
          <div key={s.id} data-chat-ref={`section:${s.id}`} className="section" style={{ left: s.start * zoom, width: Math.max(10, s.length * zoom - 2) }}>{s.name}</div>
        ))}
        {project.loop.end > project.loop.start && (
          <div className={`loop-region ${project.loop.enabled ? 'on' : ''}`} style={{ left: project.loop.start * zoom, width: (project.loop.end - project.loop.start) * zoom }} />
        )}
      </div>
    </div>
  );
}

/**
 * Drag to move the playhead. While dragging, only the position moves (no audio
 * restarts); on release, playback resumes from there if it was playing.
 */
function scrub(e: RPointerEvent, toBeat: (ev: PointerEvent | RPointerEvent) => number, bpb: number) {
  e.preventDefault();
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  const wasPlaying = useTransport.getState().playing;
  if (wasPlaying) stop(false);
  const at = (ev: PointerEvent | RPointerEvent) => Math.max(0, snapBeat(toBeat(ev), 0.25, bpb));
  useTransport.getState().setPosition(at(e));
  const onMove = (ev: PointerEvent) => useTransport.getState().setPosition(at(ev));
  const onUp = (ev: PointerEvent) => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', onUp);
    el.removeEventListener('pointercancel', onUp);
    const b = at(ev);
    if (wasPlaying) void play(b);
    else seek(b);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', onUp);
}

function Playhead({ zoom, headerW, scroller }: { zoom: number; headerW: number; scroller: React.RefObject<HTMLDivElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Position is visual state: keep 60fps transport updates out of React/layout.
    const paint = () => {
      const { position, playing } = useTransport.getState();
      const el = scroller.current;
      // Read scrolling geometry before changing styles; transform itself needs no layout.
      if (el && playing && useDaw.getState().followPlayhead) {
        const x = headerW + position * zoom;
        const visibleRight = el.scrollLeft + el.clientWidth;
        if (x > visibleRight - 60 || x < el.scrollLeft + headerW) el.scrollLeft = Math.max(0, x - headerW - 80);
      }
      if (ref.current) ref.current.style.transform = `translateX(${position * zoom}px)`;
    };
    paint();
    const transport = useTransport.subscribe((s, prev) => { if (s.position !== prev.position || s.playing !== prev.playing) paint(); });
    const daw = useDaw.subscribe((s, prev) => { if (s.followPlayhead !== prev.followPlayhead) paint(); });
    return () => { transport(); daw(); };
  }, [zoom, headerW, scroller]);
  return (
    <div className="playhead" ref={ref} style={{ left: headerW }}>
      <div
        className="playhead-grip"
        title="Drag to move the playhead"
        onPointerDown={(e) => {
          const timeline = (e.currentTarget.closest('.timeline') as HTMLElement).getBoundingClientRect();
          scrub(e, (ev) => ((ev.clientX - timeline.left) / uiZoom() - headerW) / useDaw.getState().zoom, beatsPerBar(useDaw.getState().project));
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------- empty state


const HERO_DISMISSED = 'vibe:heroDismissed';

function readDismissed(): boolean {
  try { return localStorage.getItem(HERO_DISMISSED) === '1'; } catch { return false; }
}

/** Ask Google whether a key works before saving it, so typos surface right away. */
async function checkKey(key: string): Promise<string | null> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(key)}`);
    if (res.ok) return null;
    if (res.status === 400 || res.status === 403) return 'Google rejected that key. Copy it again from AI Studio.';
    return `Couldn’t verify the key (HTTP ${res.status}). Try again in a moment.`;
  } catch {
    return 'Couldn’t reach Google to verify the key. Check your connection.';
  }
}

function KeySetup() {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const save = async () => {
    const k = key.trim();
    if (!k) return;
    setChecking(true);
    setError(null);
    const problem = await checkKey(k);
    setChecking(false);
    if (problem) { setError(problem); return; }
    useSettings.getState().set({ apiKey: k, connection: 'apikey' });
  };
  return (
    <>
      <h1>First, connect Gemini.</h1>
      <p>The agent runs on your own Gemini API key. It’s free to get, takes a minute, and covers casual use on Google’s free tier.</p>
      <ol className="key-steps">
        <li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a> and sign in with Google.</li>
        <li>Click <b>Create API key</b> and copy it.</li>
        <li>Paste it below.</li>
      </ol>
      <form className="hero-input" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <input type="password" autoFocus value={key} onChange={(e) => { setKey(e.target.value); setError(null); }} placeholder="AIza…" aria-label="Gemini API key" autoComplete="off" spellCheck={false} />
        <button className="btn primary" type="submit" disabled={checking || !key.trim()}>{checking ? 'Checking…' : 'Connect'}</button>
      </form>
      {error && <div className="err" style={{ marginTop: 10 }}>{error}</div>}
      <div className="hero-foot">Your key is saved in this browser (and in your own account if you sign in to sync) and sent only to Google.</div>
      <div className="hero-foot">Prefer Groq’s open models? Pick Groq under Settings → AI and paste a key from <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>.</div>
    </>
  );
}

/** Shown only until the user connects a Gemini key; after that the empty arrangement stays clear. */
function EmptyHero() {
  const [dismissed, setDismissed] = useState(readDismissed);
  useSettings((s) => s.apiKey + s.connection + s.provider + s.groqKey); // re-render when a key is added
  const close = () => {
    setDismissed(true);
    try { localStorage.setItem(HERO_DISMISSED, '1'); } catch { /* storage disabled */ }
  };
  // The native studio is usable without AI or an external account/key.
  // Key setup remains available when the user chooses the Producer or Settings.
  if (isNativeApp() || dismissed || aiAvailable().ok) return null;
  // Portaled to <body>: the arrangement's container query contains fixed descendants.
  return createPortal(
    <div className="empty-arrange">
      <div className="hero-card">
        <button className="btn icon hero-close" onClick={close} aria-label="Close" title="Close"><X size={16} /></button>
        <KeySetup />
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- main

export function Arrangement() {
  useKeymap((k) => k.overrides);
  const project = useDaw((s) => s.project);
  const zoom = useDaw((s) => s.zoom);
  const snap = useDaw((s) => s.snap);
  const selection = useDaw((s) => s.selection);
  const follow = useDaw((s) => s.followPlayhead);
  const { update, select, openEditor, setZoom, setSnap, setFollow } = useDaw.getState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerW = useMediaQuery(PHONE) ? HEADER_W_PHONE : HEADER_W;
  const headerRef = useRef(headerW);
  headerRef.current = headerW;
  // Cancels an in-progress touch drag (and undoes it) when a pinch starts.
  const abortTouchDrag = useRef<(() => void) | null>(null);
  const [rangeMode, setRangeMode] = useState(false);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const bpb = beatsPerBar(project);
  const totalBeats = Math.max(projectLength(project), ...(project.annotations ?? []).map((a) => a.start + a.length)) + bpb * 16;
  const width = totalBeats * zoom;
  const empty = project.tracks.length === 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Zoom around a screen x so the beat under it stays put.
    const zoomAround = (clientX: number, nextZoom: number) => {
      const hw = headerRef.current;
      const x = (clientX - el.getBoundingClientRect().left) / uiZoom() - hw;
      const anchorBeat = (el.scrollLeft + x) / useDaw.getState().zoom;
      const nz = Math.max(4, Math.min(200, nextZoom));
      useDaw.getState().setZoom(nz);
      requestAnimationFrame(() => { el.scrollLeft = anchorBeat * nz - x; });
    };
    // Scrolling the timeline sideways yourself during playback stops it following the playhead,
    // so the view doesn't yank back. Only deliberate user gestures count, never our own scrolling.
    const unfollow = () => {
      const d = useDaw.getState();
      if (!d.followPlayhead || !useTransport.getState().playing) return;
      d.setFollow(false);
      toast('Stopped following the playhead. Turn Follow playhead back on in the View menu.');
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.target !== el) return;
      // A press on the scroller itself near its bottom edge is the horizontal scrollbar
      // (classic scrollbars sit below clientHeight; overlay ones float over the last few pixels).
      const y = (e.clientY - el.getBoundingClientRect().top) / uiZoom();
      if (el.scrollWidth > el.clientWidth && y > el.clientHeight - 14) unfollow();
    };
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) {
        if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) unfollow();
        return;
      }
      e.preventDefault();
      zoomAround(e.clientX, useDaw.getState().zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    };
    // Two-finger pinch zooms the timeline horizontally on touch screens.
    let pinch: { dist: number; zoom: number } | null = null;
    const spread = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    let swipe: { x: number; y: number } | null = null;
    const onTouchStart = (e: TouchEvent) => {
      // One finger on empty timeline or an unselected clip pans; selected clips, the ruler and the playhead drag instead.
      const t = e.target as Element;
      swipe = e.touches.length === 1 && !t.closest('.clip.selected, .ruler .marks, .playhead-grip, .track-head') ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
      if (e.touches.length !== 2) return;
      abortTouchDrag.current?.();
      pinch = { dist: spread(e.touches), zoom: useDaw.getState().zoom };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (swipe && e.touches.length === 1) {
        const dx = Math.abs(e.touches[0].clientX - swipe.x), dy = Math.abs(e.touches[0].clientY - swipe.y);
        if (dx > 12 && dx > dy) { swipe = null; unfollow(); }
      }
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      zoomAround((e.touches[0].clientX + e.touches[1].clientX) / 2, pinch.zoom * (spread(e.touches) / pinch.dist));
    };
    const onTouchEnd = (e: TouchEvent) => { if (e.touches.length < 2) pinch = null; };
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  const startRange = (e: RPointerEvent) => {
    if (e.button !== 0 || (!e.shiftKey && !rangeMode) || !(e.target as HTMLElement).closest('.track-row > .lane')) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const point = (ev: { clientX: number; clientY: number }) => {
      const rect = el.getBoundingClientRect();
      return { beat: Math.max(0, snapBeat(((ev.clientX - rect.left) / uiZoom() - headerW) / zoom, snap, bpb)), y: ev.clientY };
    };
    const first = point(e);
    const move = (ev: PointerEvent | RPointerEvent) => {
      const last = point(ev);
      const start = Math.min(first.beat, last.beat);
      const end = Math.max(first.beat, last.beat, start + (snap > 0 ? snap : 0.25));
      const rows = [...el.querySelectorAll<HTMLElement>('.track-row > .lane')];
      const trackIds = project.tracks.filter((_, i) => {
        const rect = rows[i].getBoundingClientRect();
        return rect.bottom >= Math.min(first.y, last.y) && rect.top <= Math.max(first.y, last.y);
      }).map((t) => t.id);
      const clipIds = project.tracks.filter((t) => trackIds.includes(t.id)).flatMap((t) => t.clips.filter((c) => c.start < end && c.start + c.length > start).map((c) => c.id));
      select({ clipIds, trackId: trackIds[0] ?? null, range: { start, end, trackIds } });
    };
    const done = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', done);
      el.removeEventListener('pointercancel', done);
    };
    move(e);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', done);
    el.addEventListener('pointercancel', done);
  };

  const startDrag = (e: RPointerEvent, clip: Clip, track: Track, mode: 'move' | 'resize') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Another finger landing during a touch drag starts a pinch, not a second drag.
    if (e.pointerType === 'touch' && abortTouchDrag.current) { abortTouchDrag.current(); return; }
    // Shift/Ctrl-click toggles selection, except on the resize handle where Shift means fine snapping.
    const additive = mode === 'move' && (e.shiftKey || e.metaKey || e.ctrlKey);
    const ids = additive
      ? (selection.clipIds.includes(clip.id) ? selection.clipIds.filter((x) => x !== clip.id) : [...selection.clipIds, clip.id])
      : selection.clipIds.includes(clip.id) ? selection.clipIds : [clip.id];
    const wasSelected = selection.clipIds.includes(clip.id);
    select({ clipIds: ids, trackId: track.id });
    if (additive) return;
    const el = e.currentTarget as HTMLElement;
    const touch = e.pointerType === 'touch';
    // Touch has no double-click: a tap opens the clip in the editor.
    const openOnTap = (ev: PointerEvent) => { if (ev.type === 'pointerup' && mode === 'move') openEditor(clip.id); };
    if (touch && !wasSelected) {
      // An unselected clip never drags on touch, so a swipe that starts on it just scrolls.
      const done = (ev: PointerEvent) => { el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done); openOnTap(ev); };
      el.addEventListener('pointerup', done);
      el.addEventListener('pointercancel', done);
      return;
    }
    el.setPointerCapture(e.pointerId);
    const snapshot = cloneDeep(clip);
    const sx = e.clientX, sy = e.clientY;
    const uz = uiZoom();
    const origStart = clip.start, origLen = clip.length;
    const tIdx = project.tracks.findIndex((t) => t.id === track.id);
    let duplicated = false;
    let moved = false;
    let currentClipId = clip.id;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      const dxBeats = (ev.clientX - sx) / uz / zoom;
      if (!moved && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return;
      moved = true;
      const s = useDaw.getState().snap;
      if (mode === 'resize') {
        // Patterns resize in whole bars (Shift = fine grid) and repeat their content
        // when extended, like a looped clip. Audio clips follow the grid.
        const fine = s > 0 ? s : 0.25;
        let len: number;
        if (clip.type === 'midi' && !ev.shiftKey) len = Math.max(bpb, Math.round((origLen + dxBeats) / bpb) * bpb);
        else len = Math.max(fine, snapBeat(origStart + origLen + dxBeats, s, bpb) - origStart);
        update('Resize clip', (d) => {
          for (const t of d.tracks) for (const c of t.clips) {
            if (c.id !== clip.id) continue;
            c.length = len;
            if (c.type === 'midi' && clip.type === 'midi') {
              const base = clip.notes.filter((n) => n.start < origLen - 1e-6);
              c.notes = len > origLen + 1e-6 ? repeatNotes(base, origLen, len) : clip.notes.filter((n) => n.start < len - 1e-6).map((n) => ({ ...n }));
            }
          }
        }, { coalesce: true });
        return;
      }
      const newStart = Math.max(0, snapBeat(origStart + dxBeats, s, bpb));
      const dRows = Math.round((ev.clientY - sy) / uz / TRACK_H);
      update('Move clip', (d) => {
        if (ev.altKey && !duplicated) {
          // Alt-drag leaves a copy behind.
          const src = d.tracks.flatMap((t) => t.clips).find((c) => c.id === clip.id);
          const tr = d.tracks.find((t) => t.clips.some((c) => c.id === clip.id));
          if (src && tr) {
            d.nextId++;
            const copy = { ...cloneDeep(src), id: `c${d.nextId}` };
            tr.clips.push(copy);
            currentClipId = copy.id;
            duplicated = true;
          }
        }
        let fromTrack: Track | undefined;
        let c: Clip | undefined;
        for (const t of d.tracks) { const f = t.clips.find((x) => x.id === currentClipId); if (f) { fromTrack = t; c = f; } }
        if (!c || !fromTrack) return;
        c.start = newStart;
        const target = d.tracks[Math.max(0, Math.min(d.tracks.length - 1, tIdx + dRows))];
        const compatible = target && target !== fromTrack && (c.type === 'audio' ? target.kind === 'audio' : target.kind === fromTrack.kind);
        if (compatible) {
          fromTrack.clips = fromTrack.clips.filter((x) => x.id !== c!.id);
          target.clips.push(c);
        }
      }, { coalesce: true });
    };
    const detach = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      if (abortTouchDrag.current === abort) abortTouchDrag.current = null;
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== e.pointerId) return;
      detach();
      if (duplicated) select({ clipIds: [currentClipId] });
      if (touch && !moved) openOnTap(ev);
    };
    // A second finger means a pinch: drop the drag and put the clip back where it was.
    const abort = () => {
      detach();
      if (!moved || duplicated) return;
      update(mode === 'resize' ? 'Resize clip' : 'Move clip', (d) => {
        for (const t of d.tracks) t.clips = t.clips.filter((c) => c.id !== snapshot.id);
        d.tracks.find((t) => t.id === track.id)?.clips.push(cloneDeep(snapshot));
      }, { coalesce: true });
    };
    if (touch) abortTouchDrag.current = abort;
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    // A touch that turns into a scroll is canceled by the browser.
    el.addEventListener('pointercancel', onUp);
  };

  const laneDoubleClick = (e: React.MouseEvent, track: Track) => {
    if (track.kind === 'audio') return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const beat = Math.floor((e.clientX - rect.left) / uiZoom() / zoom / bpb) * bpb;
    let id = '';
    update('New clip', (d) => {
      const t = d.tracks.find((x) => x.id === track.id)!;
      const c = createMidiClip(d, beat, bpb * (track.kind === 'drums' ? 1 : 2), track.kind === 'drums' ? 'Beat' : 'Pattern');
      t.clips.push(c);
      id = c.id;
    });
    select({ clipIds: [id], trackId: track.id });
    openEditor(id);
  };

  const onLaneDrop = (e: React.DragEvent, track: Track | null) => {
    e.preventDefault();
    setDropTrack(null);
    const sampleId = e.dataTransfer.getData('application/x-vibe-sample');
    const preset = e.dataTransfer.getData('application/x-vibe-preset');
    if (preset) {
      update('Add track', (d) => { d.tracks.push(createTrack(d, 'instrument', { preset })); });
      return;
    }
    if (!sampleId) return;
    const lane = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const beat = Math.max(0, snapBeat((e.clientX - lane.left) / uiZoom() / zoom, snap <= 0 ? bpb : snap, bpb));
    placeSample(sampleId, track?.id ?? null, track ? beat : 0);
  };

  const laneBg = (i: number) => ({
    width,
    backgroundColor: i % 2 ? 'var(--lane-b)' : 'var(--lane-a)',
    backgroundImage: `linear-gradient(to right, var(--grid-bar) 1px, transparent 1px), linear-gradient(to right, var(--grid-beat) 1px, transparent 1px)`,
    backgroundSize: `${bpb * zoom}px 100%, ${zoom}px 100%`,
  });

  const addTrack = addTrackAction;

  return (
    <section className="arrange" style={{ ['--header-w' as string]: `${headerW}px`, ['--track-h' as string]: `${TRACK_H}px` }} aria-label="Arrangement">
      <div className="arrange-tools">
        <AddTrackMenu />
        <Dropdown label="Clip actions" content={(close) => {
          const pick = (action: () => void) => () => { close(); action(); };
          const selected = !!selection.clipIds.length;
          return <>
            <button className="menu-item" role="menuitem" disabled={!project.tracks.some((t) => t.kind !== 'audio')} onClick={pick(newClipOnSelectedTrack)}><b><Plus size={14} /> New clip</b></button>
            <button className="menu-item" role="menuitem" disabled={!selected} onClick={pick(copySelectedClips)}><b><Copy size={14} /> Copy selected clips</b></button>
            <button className="menu-item" role="menuitem" onClick={pick(pasteClips)}><b><ClipboardPaste size={14} /> Paste clips at the playhead</b></button>
            <button className="menu-item" role="menuitem" disabled={!selected} onClick={pick(duplicateSelectedClips)}><b><CopyPlus size={14} /> Duplicate selected clips</b></button>
            <button className="menu-item" role="menuitem" onClick={pick(splitAtPlayhead)}><b><Scissors size={14} /> Split clips at the playhead</b></button>
            <div className="menu-divider" />
            <button className="menu-item" role="menuitem" disabled={!selected && !selection.range} onClick={pick(() => attachChatReference('selection'))}><b><MessageSquarePlus size={14} /> Add selection to chat</b></button>
            <button className="menu-item" role="menuitem" disabled={!selected} onClick={pick(saveSelectedClips)}><b><Bookmark size={14} /> Save selected clips to library</b></button>
            <button className="menu-item danger" role="menuitem" disabled={!selected} onClick={pick(deleteSelectedClips)}><b><Trash size={14} /> Delete selected clips</b></button>
          </>;
        }}>Clips</Dropdown>
        <button className={`btn ${rangeMode ? 'active' : ''}`} aria-pressed={rangeMode} onClick={() => setRangeMode((v) => !v)} title="Drag across tracks to select a time range. Shift-drag also works."><MousePointer2 size={14} /> Range</button>
        <button className="btn" onClick={() => openInlineAI()} disabled={!selection.clipIds.length} title="Edit the selected notes or region with AI (Ctrl+K)" aria-label="Edit selection"><MessageSquarePlus size={14} /><span className="btn-label">Edit selection</span></button>
        <div className="spacer" />
        <Dropdown label="Timeline view" content={() => <>
          <label className="menu-control" title="Clips snap to this grid when you move or resize them">Snap to grid
            <select value={snap} onChange={(e) => setSnap(Number(e.target.value))} aria-label="Snap">
              {SNAPS.map(([l, v]) => <option key={l} value={v}>{l}</option>)}
            </select>
          </label>
          <button className={`menu-item toggle-item ${follow ? 'on' : ''}`} role="menuitemcheckbox" aria-checked={follow} onClick={() => setFollow(!follow)} title="Scroll the timeline to keep the playhead in view"><b>Follow playhead</b><span className="toggle-switch" aria-hidden="true" /></button>
          <div className="menu-divider" />
          <button className="menu-item" role="menuitem" title={tip('Zoom out', 'zoomOut')} onClick={() => setZoom(zoom / 1.3)}><b><ZoomOut size={15} /> Zoom out</b></button>
          <button className="menu-item" role="menuitem" title={tip('Zoom in', 'zoomIn')} onClick={() => setZoom(zoom * 1.3)}><b><ZoomIn size={15} /> Zoom in</b></button>
        </>}>View</Dropdown>
      </div>
      <div className="scroller" ref={scrollRef} onPointerDown={(e) => { if (e.target === e.currentTarget) select({ clipIds: [] }); }}>
        <div className={`timeline ${rangeMode ? 'selecting-range' : ''}`} style={{ width: headerW + width }} onPointerDownCapture={startRange}>
          <Ruler project={project} zoom={zoom} width={width} />
          <AnnotationLane project={project} zoom={zoom} width={width} />
          {project.tracks.map((t, i) => (
            <div className="track-row" key={t.id}>
              <TrackHeader track={t} selected={selection.trackId === t.id} />
              <div
                className={`lane ${dropTrack === t.id ? 'drop-target' : ''}`}
                style={laneBg(i)}
                onPointerDown={(e) => { if (e.target === e.currentTarget) select({ clipIds: [], trackId: t.id }); }}
                onDoubleClick={(e) => { if (e.target === e.currentTarget) laneDoubleClick(e, t); }}
                onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-vibe-sample')) { e.preventDefault(); setDropTrack(t.id); } }}
                onDragLeave={() => setDropTrack(null)}
                onDrop={(e) => onLaneDrop(e, t)}
              >
                {!t.clips.length && (
                  <div className="lane-hint">
                    <span className="hide-touch">{t.kind === 'audio' ? 'Drag a sound from the left panel onto this lane' : 'Double-click here (or use Clips → New clip) to draw a pattern'}</span>
                    <span className="only-touch">{t.kind === 'audio' ? 'Tap + next to a sound in the browser to add it' : 'Tap New clip to draw a pattern'}</span>
                  </div>
                )}
                {selection.range?.trackIds.includes(t.id) && <div className="selection-region" style={{ left: selection.range.start * zoom, width: (selection.range.end - selection.range.start) * zoom }} />}
                {t.clips.map((c) => (
                  <ClipView
                    key={c.id}
                    clip={c}
                    track={t}
                    project={project}
                    zoom={zoom}
                    selected={selection.clipIds.includes(c.id)}
                    onPointerDown={(e, mode) => startDrag(e, c, t, mode)}
                    onDoubleClick={() => openEditor(c.id)}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="add-track-row">
            <div className="track-head">
              <button className="btn" onClick={() => addTrack('drums')} title="Add drum track" aria-label="Add drum track"><Drum size={14} /> <span className="btn-label">Drums</span></button>
              <button className="btn" onClick={() => addTrack('instrument')} title="Add instrument track" aria-label="Add instrument track"><Piano size={14} /> <span className="btn-label">Synth</span></button>
              <button className="btn icon" onClick={() => addTrack('audio')} title="Add audio track"><AudioLines size={14} /></button>
            </div>
            <div
              className={`lane ${dropTrack === '__new' ? 'drop-target' : ''}`}
              style={{ width, display: 'flex', alignItems: 'center', paddingLeft: 12, color: 'var(--faint)', fontSize: 12 }}
              onDragOver={(e) => { e.preventDefault(); setDropTrack('__new'); }}
              onDragLeave={() => setDropTrack(null)}
              onDrop={(e) => onLaneDrop(e, null)}
            >
              <Plus size={13} />&nbsp;<span className="hide-touch">Drop a sound or instrument here for a new track</span><span className="only-touch">Add a track</span>
            </div>
          </div>
          <Playhead zoom={zoom} headerW={headerW} scroller={scrollRef} />
        </div>
        {empty && !project.annotations?.length && <EmptyHero />}
      </div>
    </section>
  );
}

const TrackHeader = memo(function TrackHeader({ track, selected }: { track: Track; selected: boolean }) {
  const { update, select, setBottom } = useDaw.getState();
  const sub = track.kind === 'instrument' ? PRESET_BY_ID[track.instrument?.preset ?? '']?.name ?? track.instrument?.preset : track.kind === 'drums' ? `Drum kit · ${track.drumLanes?.length ?? 0} lanes` : 'Audio';
  const set = (label: string, fn: (t: Track) => void) => update(label, (d) => { const t = d.tracks.find((x) => x.id === track.id); if (t) fn(t); });
  return (
    <div data-chat-ref={`track:${track.id}`} className={`track-head ${selected ? 'selected' : ''}`} onPointerDown={() => select({ trackId: track.id })} onDoubleClick={() => setBottom('editor')}>
      <div className="swatch" style={{ background: track.color, color: track.color }} />
      <input className="tname" value={track.name} aria-label="Track name" onChange={(e) => update('Rename track', (d) => { const t = d.tracks.find((x) => x.id === track.id); if (t) t.name = e.target.value; }, { coalesce: true })} />
      <div className="tbtns">
        <button className={`ms m ${track.mute ? 'on' : ''}`} title="Mute this track" onClick={() => set('Mute', (t) => { t.mute = !t.mute; })}>M</button>
        <button className={`ms s ${track.solo ? 'on' : ''}`} title="Solo: hear only this track" onClick={() => set('Solo', (t) => { t.solo = !t.solo; })}>S</button>
      </div>
      <div className="tsub">
        <span>{sub}</span>
        <div className="tactions">
          <AddToChat referenceId={`track:${track.id}`} label={track.name} mini />
          <button className="add-mini danger" title="Delete this track" aria-label={`Delete ${track.name}`} onClick={(e) => { e.stopPropagation(); update(`Delete ${track.name}`, (d) => { d.tracks = d.tracks.filter((x) => x.id !== track.id); }); }}><Trash size={12} /></button>
        </div>
      </div>
    </div>
  );
});

function AddTrackMenu() {
  return <Dropdown label="Add track" className="solid" content={(close) => {
    const pick = (kind: 'drums' | 'instrument' | 'audio') => { close(); addTrackAction(kind); };
    return <>
      <button className="menu-item" role="menuitem" onClick={() => pick('drums')}><b><Drum size={13} /> Drums</b><span>Step-sequenced drum kit</span></button>
      <button className="menu-item" role="menuitem" onClick={() => pick('instrument')}><b><Piano size={13} /> Instrument</b><span>Piano, guitar, 808, synths (change it in Sound &amp; FX)</span></button>
      <button className="menu-item" role="menuitem" onClick={() => pick('audio')}><b><AudioLines size={13} /> Audio</b><span>For samples and loops you drag in</span></button>
    </>;
  }}><Plus size={14} /><span className="btn-label">Add track</span></Dropdown>;
}
