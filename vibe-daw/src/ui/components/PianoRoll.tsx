import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Pencil, MousePointer2, Trash } from '../icons';
import { useDaw, useTransport } from '../../state/store';
import type { MidiClip, Note, Project, Track } from '../../model/types';
import { beatsPerBar, uid } from '../../model/project';
import { isInKey, midiToNote } from '../../model/theory';
import { transformNotes } from '../../model/edit';
import { previewNote } from '../../engine/api';
import { copyNotes, getCopiedNotes } from '../clipboard';
import { matches, tip } from '../../state/keymap';
import { openInlineAI } from './InlineAI';
import { uiZoom, useMediaQuery } from '../hooks';

const ROW = 14;
const LOW = 21; // A0
const HIGH = 108; // C8
const ROWS = HIGH - LOW + 1;
const BLACK = new Set([1, 3, 6, 8, 10]);

type Tool = 'draw' | 'select';
const NO_NOTES: string[] = [];

export function PianoRoll({ clip, track, project }: { clip: MidiClip; track: Track; project: Project }) {
  const update = useDaw((s) => s.update);
  const [ppb, setPpb] = useState(72);
  const [grid, setGrid] = useState(0.25);
  const [tool, setTool] = useState<Tool>('draw');
  const selected = useDaw((s) => s.selection.notes?.find((n) => n.clipId === clip.id)?.noteIds ?? NO_NOTES);
  const setSelected = (noteIds: string[]) => useDaw.getState().select({
    trackId: track.id, clipIds: [clip.id], notes: noteIds.length ? [{ clipId: clip.id, noteIds }] : undefined,
  });
  const [lastLen, setLastLen] = useState(0.5);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const bpb = beatsPerBar(project);
  const width = Math.max(clip.length + bpb, 8) * ppb;
  const step = grid > 0 ? grid : 0.25;

  // Center the view on the clip's notes when a different clip opens.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const pitches = clip.notes.map((n) => n.pitch);
    const mid = pitches.length ? (Math.min(...pitches) + Math.max(...pitches)) / 2 : track.kind === 'instrument' && track.instrument?.preset === 'bass808' ? 30 : 60;
    el.scrollTop = (HIGH - mid) * ROW - el.clientHeight / 2;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  const editNotes = (label: string, fn: (notes: Note[], c: MidiClip) => void, coalesce = true) => {
    update(label, (d) => {
      for (const t of d.tracks) for (const c of t.clips) if (c.id === clip.id && c.type === 'midi') { fn(c.notes, c); delete c.aiPending; }
    }, { coalesce });
  };

  const snap = (b: number) => (grid > 0 ? Math.round(b / grid) * grid : b);
  const floorSnap = (b: number) => (grid > 0 ? Math.floor(b / grid) * grid : b);

  const posFrom = (e: { clientX: number; clientY: number }) => {
    const rect = gridRef.current!.getBoundingClientRect();
    const z = uiZoom();
    const x = (e.clientX - rect.left) / z, y = (e.clientY - rect.top) / z;
    const pitch = HIGH - Math.floor(y / ROW);
    return { beat: x / ppb, pitch: Math.max(LOW, Math.min(HIGH, pitch)), x, y };
  };

  const startMarquee = (e: RPointerEvent, additive: boolean) => {
    const p0 = posFrom(e);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const base = additive ? selected : [];
    setMarquee({ x0: p0.x, y0: p0.y, x1: p0.x, y1: p0.y });
    const onMove = (ev: PointerEvent) => {
      const p = posFrom(ev);
      setMarquee({ x0: p0.x, y0: p0.y, x1: p.x, y1: p.y });
      const [bx0, bx1] = [Math.min(p0.x, p.x) / ppb, Math.max(p0.x, p.x) / ppb];
      const [py0, py1] = [HIGH - Math.floor(Math.max(p0.y, p.y) / ROW), HIGH - Math.floor(Math.min(p0.y, p.y) / ROW)];
      const hit = clip.notes.filter((n) => n.start < bx1 && n.start + n.duration > bx0 && n.pitch >= py0 && n.pitch <= py1).map((n) => n.id);
      setSelected([...new Set([...base, ...hit])]);
    };
    const onUp = () => {
      setMarquee(null);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  const onGridDown = (e: RPointerEvent) => {
    bodyRef.current?.focus({ preventScroll: true });
    if (e.button !== 0 || e.target !== e.currentTarget) return;
    // Select tool, or Ctrl/Shift-drag in draw mode: box-select.
    if (tool === 'select' || e.ctrlKey || e.metaKey || e.shiftKey) {
      startMarquee(e, e.shiftKey);
      return;
    }
    const { beat, pitch } = posFrom(e);
    const start = Math.max(0, floorSnap(beat));
    if (start >= clip.length) return;
    if (e.pointerType === 'touch') {
      // Touch: a swipe scrolls the roll, so add the note on a clean tap (at the last length used).
      const el = e.currentTarget as HTMLElement;
      const done = (ev: PointerEvent) => {
        el.removeEventListener('pointerup', done);
        el.removeEventListener('pointercancel', done);
        if (ev.type !== 'pointerup') return;
        const id = uid();
        editNotes('Add note', (ns) => { ns.push({ id, pitch, start, duration: Math.min(lastLen, clip.length - start), velocity: 0.8 }); }, false);
        setSelected([id]);
        previewNote(track.id, pitch, 0.8);
      };
      el.addEventListener('pointerup', done);
      el.addEventListener('pointercancel', done);
      return;
    }
    const id = uid();
    const note: Note = { id, pitch, start, duration: Math.min(lastLen, clip.length - start), velocity: 0.8 };
    editNotes('Add note', (ns) => { ns.push(note); }, false);
    setSelected([id]);
    previewNote(track.id, pitch, 0.8);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const b = posFrom(ev).beat;
      const len = Math.max(grid > 0 ? grid : 0.05, snap(b) - start);
      editNotes('Add note', (ns) => { const n = ns.find((x) => x.id === id); if (n) n.duration = len; });
      setLastLen(len);
    };
    const onUp = () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp); };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  const onNoteDown = (e: RPointerEvent, n: Note, mode: 'move' | 'resize') => {
    e.stopPropagation();
    bodyRef.current?.focus({ preventScroll: true });
    if (e.button === 2) return;
    const sel = e.shiftKey ? (selected.includes(n.id) ? selected.filter((x) => x !== n.id) : [...selected, n.id]) : selected.includes(n.id) ? selected : [n.id];
    setSelected(sel);
    if (e.shiftKey) return;
    if (mode === 'move') previewNote(track.id, n.pitch, n.velocity);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const p0 = posFrom(e);
    let ids = sel;
    let orig = new Map(clip.notes.filter((x) => ids.includes(x.id)).map((x) => [x.id, { ...x }]));
    let copied = false;
    let lastPitchDelta = 0;
    const onMove = (ev: PointerEvent) => {
      const p = posFrom(ev);
      const db = p.beat - p0.beat;
      if (mode === 'resize') {
        editNotes('Resize notes', (ns) => {
          for (const x of ns) {
            const o = orig.get(x.id);
            if (o) x.duration = Math.max(grid > 0 ? grid / 2 : 0.05, snap(o.start + o.duration + db) - o.start);
          }
        });
        return;
      }
      // Alt-drag leaves the originals in place and moves copies.
      if (ev.altKey && !copied) {
        copied = true;
        const copies = [...orig.values()].map((o) => ({ ...o, id: uid() }));
        editNotes('Copy notes', (ns) => { ns.push(...copies.map((c) => ({ ...c }))); }, false);
        ids = copies.map((c) => c.id);
        orig = new Map(copies.map((c) => [c.id, c]));
        setSelected(ids);
      }
      const dp = p.pitch - p0.pitch;
      const dbSnapped = grid > 0 ? Math.round(db / grid) * grid : db;
      editNotes('Move notes', (ns) => {
        for (const x of ns) {
          const o = orig.get(x.id);
          if (!o) continue;
          x.start = Math.max(0, Math.min(clip.length - 0.01, o.start + dbSnapped));
          x.pitch = Math.max(0, Math.min(127, o.pitch + dp));
        }
      });
      if (dp !== lastPitchDelta) { lastPitchDelta = dp; previewNote(track.id, n.pitch + dp, n.velocity); }
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  const deleteNotes = (ids: string[]) => {
    if (!ids.length) return;
    editNotes('Delete notes', (ns, c) => { c.notes = ns.filter((x) => !ids.includes(x.id)); }, false);
    setSelected([]);
  };

  const selectedNotes = () => clip.notes.filter((n) => selected.includes(n.id));

  const paste = () => {
    const cb = getCopiedNotes();
    if (!cb) return;
    // Paste at the playhead if it's inside this clip, else right after the selection (or at the clip start).
    const playhead = useTransport.getState().position - clip.start;
    const sel = selectedNotes();
    let at = sel.length ? Math.max(...sel.map((n) => n.start + n.duration)) : 0;
    if (playhead >= 0 && playhead < clip.length && !sel.length) at = playhead;
    at = grid > 0 ? Math.round(at / grid) * grid : at;
    const fresh = cb.items.map((n) => ({ ...n, id: uid(), start: n.start + at })).filter((n) => n.start < clip.length);
    if (!fresh.length) return;
    editNotes('Paste notes', (ns) => { ns.push(...fresh); }, false);
    setSelected(fresh.map((n) => n.id));
  };

  const onKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (matches(e, 'delete')) { handled(); deleteNotes(selected); }
    else if (mod && k === 'a') { handled(); setSelected(clip.notes.map((n) => n.id)); }
    else if (matches(e, 'copy')) { handled(); copyNotes(selectedNotes()); }
    else if (matches(e, 'cut')) { handled(); copyNotes(selectedNotes()); deleteNotes(selected); }
    else if (matches(e, 'paste')) { handled(); paste(); }
    else if (matches(e, 'duplicate')) {
      handled();
      const sel = selectedNotes();
      if (!sel.length) return;
      const span = Math.max(...sel.map((n) => n.start + n.duration)) - Math.min(...sel.map((n) => n.start));
      const shift = Math.ceil(span / step - 1e-6) * step;
      const copies = sel.map((n) => ({ ...n, id: uid(), start: n.start + shift })).filter((n) => n.start < clip.length);
      editNotes('Duplicate notes', (ns) => { ns.push(...copies); }, false);
      setSelected(copies.map((n) => n.id));
    } else if (e.key === 'Escape') { handled(); setSelected([]); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      handled();
      const d = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 12 : 1);
      editNotes('Transpose notes', (ns) => { for (const x of ns) if (selected.includes(x.id)) x.pitch = Math.max(0, Math.min(127, x.pitch + d)); });
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      handled();
      const d = (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? bpb : step);
      editNotes('Nudge notes', (ns) => { for (const x of ns) if (selected.includes(x.id)) x.start = Math.max(0, Math.min(clip.length - 0.01, x.start + d)); });
    } else if (matches(e, 'quantize')) {
      handled();
      const ids = selected.length ? selected : clip.notes.map((n) => n.id);
      editNotes('Quantize', (ns) => {
        for (const x of ns) if (ids.includes(x.id)) { x.start = Math.round(x.start / step) * step; x.duration = Math.max(step / 2, Math.round(x.duration / step) * step || step); }
      }, false);
    } else if (matches(e, 'drawTool')) { handled(); setTool('draw'); }
    else if (matches(e, 'selectTool')) { handled(); setTool('select'); }
  };

  const rows = useMemo(() => Array.from({ length: ROWS }, (_, i) => HIGH - i), []);
  const color = track.color;
  const sel = selected.length;

  return (
    <div className="roll">
      <div className="roll-tools">
        <input type="text" value={clip.name} aria-label="Clip name" title="Clip name" onChange={(e) => editNotes('Rename clip', (_, c) => { c.name = e.target.value; })} />
        <label className="group" title="Clip length in bars">Length
          <input type="number" min={0.25} step={0.25} value={Math.round((clip.length / bpb) * 100) / 100} aria-label="Clip length in bars" onChange={(e) => { const v = Number(e.target.value); if (v > 0) editNotes('Clip length', (_, c) => { c.length = v * bpb; }); }} />
          <span className="unit-label">bars</span>
        </label>
        <label className="group" title="Notes snap to this grid">Snap
          <select value={grid} onChange={(e) => setGrid(Number(e.target.value))} aria-label="Snap">
            <option value={1}>1/4</option><option value={0.5}>1/8</option><option value={1 / 3}>1/8 triplet</option><option value={0.25}>1/16</option><option value={1 / 6}>1/16 triplet</option><option value={0.125}>1/32</option><option value={0}>Off</option>
          </select>
        </label>
        <div className="group seg tools" role="radiogroup" aria-label="Tool">
          <button className={tool === 'draw' ? 'on' : ''} onClick={() => setTool('draw')} role="radio" aria-checked={tool === 'draw'} title={tip('Draw: click to add notes, drag to set length', 'drawTool')}><Pencil size={13} /> Draw</button>
          <button className={tool === 'select' ? 'on' : ''} onClick={() => setTool('select')} role="radio" aria-checked={tool === 'select'} title={tip('Select: drag a box to select notes', 'selectTool')}><MousePointer2 size={13} /> Select</button>
        </div>
        <div className="group">
          <button className="btn" onClick={() => { const ids = selected.length ? selected : clip.notes.map((n) => n.id); editNotes('Quantize', (ns) => { for (const x of ns) if (ids.includes(x.id)) { x.start = Math.round(x.start / step) * step; x.duration = Math.max(step / 2, Math.round(x.duration / step) * step || step); } }, false); }} title={`Snap ${sel ? 'selected' : 'all'} notes to the grid (Q)`}>Quantize</button>
          <button className="btn" onClick={() => editNotes('Snap to key', (_, c) => { transformNotes(c, 'snap_to_key', undefined, project.key); }, false)} title="Move notes that are outside the song key into it">Fix key</button>
          <button className="btn" onClick={() => editNotes('Octave down', (ns) => { for (const x of ns) if (!sel || selected.includes(x.id)) x.pitch = Math.max(0, x.pitch - 12); }, false)} title={`Move ${sel ? 'selected' : 'all'} notes down an octave (Shift+↓)`}>−Oct</button>
          <button className="btn" onClick={() => editNotes('Octave up', (ns) => { for (const x of ns) if (!sel || selected.includes(x.id)) x.pitch = Math.min(127, x.pitch + 12); }, false)} title={`Move ${sel ? 'selected' : 'all'} notes up an octave (Shift+↑)`}>+Oct</button>
        </div>
        <div className="group">
          <button className="btn icon" onClick={() => setPpb((z) => Math.max(16, z / 1.25))} aria-label="Zoom out" title="Zoom out">−</button>
          <button className="btn icon" onClick={() => setPpb((z) => Math.min(400, z * 1.25))} aria-label="Zoom in" title="Zoom in">+</button>
          <button className="btn icon danger" onClick={() => deleteNotes(selected)} disabled={!sel} aria-label="Delete selected notes" title={tip('Delete selected notes', 'delete')}><Trash size={14} /></button>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => openInlineAI([clip.id])} title="Ask the agent to change this clip (Ctrl+K)"><span className="ai-ink">Edit with AI</span></button>
      </div>
      <div className="roll-body" ref={bodyRef} tabIndex={0} onKeyDown={onKey}>
        <div className="keys" style={{ height: ROWS * ROW }}>
          {rows.map((p, i) => {
            const black = BLACK.has(p % 12);
            return (
              <div
                key={p}
                className={`key ${black ? 'black' : 'white'} ${p % 12 === 0 ? 'c' : ''}`}
                style={{ top: i * ROW, height: ROW }}
                onPointerDown={() => previewNote(track.id, p, 0.8)}
                title={midiToNote(p)}
              >
                {p % 12 === 0 ? midiToNote(p) : ''}
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            ref={gridRef}
            className={`grid ${tool === 'select' ? 'select-tool' : ''}`}
            style={{
              width,
              height: ROWS * ROW,
              backgroundImage: `linear-gradient(to right, rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px)${grid > 0 && grid < 1 ? ', linear-gradient(to right, rgba(255,255,255,0.025) 1px, transparent 1px)' : ''}`,
              backgroundSize: `${bpb * ppb}px 100%, ${ppb}px 100%${grid > 0 && grid < 1 ? `, ${grid * ppb}px 100%` : ''}`,
            }}
            onPointerDown={onGridDown}
            onContextMenu={(e) => e.preventDefault()}
          >
            {rows.map((p, i) => (
              <div key={p} className="row-bg" style={{ top: i * ROW, height: ROW, background: BLACK.has(p % 12) ? 'var(--roll-black)' : isInKey(p, project.key) ? 'var(--roll-inkey)' : 'var(--roll-white)', borderBottom: p % 12 === 0 ? '1px solid rgba(255,255,255,0.09)' : undefined, pointerEvents: 'none' }} />
            ))}
            <div style={{ position: 'absolute', left: clip.length * ppb, top: 0, bottom: 0, right: 0, background: 'rgba(0,0,0,0.35)', pointerEvents: 'none' }} />
            <RollPlayhead clipStart={clip.start} clipLength={clip.length} ppb={ppb} />
            {clip.notes.map((n) => (
              <div
                key={n.id}
                className={`note ${selected.includes(n.id) ? 'selected' : ''}`}
                style={{ left: n.start * ppb, top: (HIGH - n.pitch) * ROW + 1, width: Math.max(4, n.duration * ppb - 1), height: ROW - 2, ['--c' as string]: color, opacity: 0.45 + n.velocity * 0.55 }}
                onPointerDown={(e) => onNoteDown(e, n, 'move')}
                onDoubleClick={() => deleteNotes([n.id])}
                onContextMenu={(e) => { e.preventDefault(); deleteNotes([n.id]); }}
              >
                <div className="nresize" onPointerDown={(e) => onNoteDown(e, n, 'resize')} />
              </div>
            ))}
            {marquee && (
              <div className="marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />
            )}
          </div>
          <VelocityLane clip={clip} ppb={ppb} width={width} color={color} selected={selected} onEdit={editNotes} />
        </div>
      </div>
      <div className="editor-hint">
        <span className="hide-touch">
          {tool === 'draw' ? 'Click to add a note · drag to set its length' : 'Drag to box-select'} · drag a note to move (Alt = copy) · drag its right edge to resize · right-click to delete ·
          Ctrl+C / X / V copy, cut, paste · ←→ nudge · ↑↓ transpose · Q quantize
        </span>
        <span className="only-touch">{tool === 'draw' ? 'Tap to add a note' : 'Drag to box-select'} · drag a note to move · drag its right edge to resize · swipe empty space to scroll</span>
        {sel > 0 && <b> · {sel} selected</b>}
      </div>
    </div>
  );
}

function RollPlayhead({ clipStart, clipLength, ppb }: { clipStart: number; clipLength: number; ppb: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const paint = () => {
      const el = ref.current;
      if (!el) return;
      const pos = useTransport.getState().position - clipStart;
      el.style.display = pos < 0 || pos > clipLength ? 'none' : '';
      el.style.transform = `translateX(${pos * ppb}px)`;
    };
    paint();
    return useTransport.subscribe((s, prev) => { if (s.position !== prev.position) paint(); });
  }, [clipStart, clipLength, ppb]);
  return <div className="roll-playhead" ref={ref} style={{ left: 0 }} />;
}

function VelocityLane({ clip, ppb, width, color, selected, onEdit }: { clip: MidiClip; ppb: number; width: number; color: string; selected: string[]; onEdit: (label: string, fn: (ns: Note[]) => void) => void }) {
  const H = useMediaQuery('(max-height: 500px)') ? 32 : 56;
  const set = (e: RPointerEvent | PointerEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const z = uiZoom();
    const beat = (e.clientX - rect.left) / z / ppb;
    const v = Math.max(0.05, Math.min(1, 1 - (e.clientY - rect.top) / z / H));
    const target = clip.notes.reduce<Note | null>((best, n) => (Math.abs(n.start - beat) < 0.2 && (!best || Math.abs(n.start - beat) < Math.abs(best.start - beat)) ? n : best), null);
    if (!target) return;
    const ids = selected.includes(target.id) ? selected : [target.id];
    onEdit('Velocity', (ns) => { for (const n of ns) if (ids.includes(n.id)) n.velocity = v; });
  };
  return (
    <div
      className="velocity"
      style={{ width, height: H, position: 'sticky', bottom: 0 }}
      onPointerDown={(e) => {
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        set(e, el);
        const mv = (ev: PointerEvent) => set(ev, el);
        const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
        el.addEventListener('pointermove', mv);
        el.addEventListener('pointerup', up);
        el.addEventListener('pointercancel', up);
      }}
      title="Velocity: drag a bar up or down (affects all selected notes)"
    >
      {clip.notes.map((n) => (
        <div key={n.id} className="vel-bar" style={{ left: n.start * ppb, height: n.velocity * (H - 4), ['--c' as string]: selected.includes(n.id) ? '#fff' : color }} />
      ))}
    </div>
  );
}
