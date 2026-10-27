import { useMemo, useRef, useState } from 'react';
import { Play, MousePointer2 } from '../icons';
import { useDaw } from '../../state/store';
import type { MidiClip, Project, Track } from '../../model/types';
import { beatsPerBar, uid } from '../../model/project';
import { previewNote } from '../../engine/api';
import { openInlineAI } from './InlineAI';

const RES: Array<[string, number]> = [['1/16', 4], ['1/32', 8], ['1/8T', 3], ['1/16T', 6], ['1/8', 2]];

export function DrumEditor({ clip, track, project }: { clip: MidiClip; track: Track; project: Project }) {
  const update = useDaw((s) => s.update);
  const [selectMode, setSelectMode] = useState(false);
  const dragging = useRef(false);
  const selected = useDaw((s) => s.selection.notes?.find((n) => n.clipId === clip.id)?.noteIds);
  const [perBeat, setPerBeat] = useState(4);
  const bpb = beatsPerBar(project);
  const stepLen = 1 / perBeat;
  const steps = Math.round(clip.length * perBeat);
  const lanes = track.drumLanes ?? [];

  const edit = (label: string, fn: (c: MidiClip) => void) => update(label, (d) => {
    for (const t of d.tracks) for (const c of t.clips) if (c.id === clip.id && c.type === 'midi') { fn(c); delete c.aiPending; }
  });

  const buckets = useMemo(() => {
    const map = new Map<string, MidiClip['notes']>();
    for (const n of clip.notes) {
      const key = `${n.pitch}:${Math.floor((n.start + 1e-6) * perBeat)}`;
      const hits = map.get(key) ?? []; hits.push(n); map.set(key, hits);
    }
    return map;
  }, [clip.notes, perBeat]);
  const hitsIn = (note: number, i: number) => buckets.get(`${note}:${i}`) ?? [];
  const selectRegion = (e: React.PointerEvent) => {
    if (e.button !== 0 || (!e.shiftKey && !selectMode)) return;
    const step = (e.target as HTMLElement).closest<HTMLElement>('[data-step]');
    if (!step) return;
    e.preventDefault(); e.stopPropagation(); dragging.current = true;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const firstStep = Number(step.dataset.step), firstLane = Number(step.dataset.lane);
    const apply = (cell: HTMLElement) => {
      const lastStep = Number(cell.dataset.step), lastLane = Number(cell.dataset.lane);
      const pitches = new Set(lanes.slice(Math.min(firstLane, lastLane), Math.max(firstLane, lastLane) + 1).map((l) => l.note));
      const from = Math.min(firstStep, lastStep) * stepLen, to = (Math.max(firstStep, lastStep) + 1) * stepLen;
      const noteIds = clip.notes.filter((n) => pitches.has(n.pitch) && n.start >= from - 1e-6 && n.start < to - 1e-6).map((n) => n.id);
      useDaw.getState().select({ clipIds: [clip.id], trackId: track.id, notes: [{ clipId: clip.id, noteIds }] });
    };
    apply(step);
    const move = (ev: PointerEvent) => {
      const cell = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-step]');
      if (cell && el.contains(cell)) apply(cell);
    };
    const done = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', done); el.removeEventListener('pointercancel', done);
      setTimeout(() => { dragging.current = false; }, 0);
    };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', done); el.addEventListener('pointercancel', done);
  };

  const toggle = (note: number, i: number, e: React.MouseEvent) => {
    if (dragging.current || selectMode || e.shiftKey) return;
    const existing = hitsIn(note, i);
    if (existing.length) {
      const ids = new Set(existing.map((n) => n.id));
      edit('Remove hit', (c) => { c.notes = c.notes.filter((n) => !ids.has(n.id)); });
      return;
    }
    const velocity = (e.ctrlKey || e.metaKey) ? 1 : e.altKey ? 0.45 : 0.85;
    edit('Add hit', (c) => { c.notes.push({ id: uid(), pitch: note, start: i * stepLen, duration: 0.25, velocity }); });
    previewNote(track.id, note, velocity);
  };

  return (
    <div className="roll">
      <div className="roll-tools">
        <input type="text" value={clip.name} aria-label="Clip name" onChange={(e) => edit('Rename clip', (c) => { c.name = e.target.value; })} />
        <label className="group">Bars
          <input type="number" min={0.25} step={0.25} value={Math.round((clip.length / bpb) * 100) / 100} aria-label="Clip length in bars" onChange={(e) => { const v = Number(e.target.value); if (v > 0) edit('Clip length', (c) => { c.length = v * bpb; }); }} />
        </label>
        <label className="group">Steps
          <select value={perBeat} onChange={(e) => setPerBeat(Number(e.target.value))} aria-label="Step resolution">
            {RES.map(([l, v]) => <option key={l} value={v}>{l}</option>)}
          </select>
        </label>
        <span className="hide-touch" style={{ color: 'var(--faint)', fontSize: 12, marginLeft: 8 }}>Click to toggle · Ctrl = accent · Alt = ghost · Shift-drag to select</span>
        <button className="btn" aria-pressed={selectMode} onClick={() => setSelectMode((v) => !v)}><MousePointer2 size={14} /> Select{selected?.length ? ` · ${selected.length}` : ''}</button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => openInlineAI([clip.id])}><span className="ai-ink">Edit with AI</span></button>
      </div>
      <div className={`drum-grid ${selectMode ? 'selecting-range' : ''}`} onPointerDownCapture={selectRegion}>
        {lanes.map((l, laneIndex) => (
          <div className="drum-row" key={l.id}>
            <div className="lname">
              <button className="btn icon" style={{ width: 22, height: 22 }} onClick={() => previewNote(track.id, l.note, 0.9)} aria-label={`Preview ${l.name}`}><Play size={11} /></button>
              {l.name}
            </div>
            <div className="steps">
              {Array.from({ length: steps }, (_, i) => {
                const hits = hitsIn(l.note, i);
                const on = hits.length > 0;
                const vel = on ? Math.max(...hits.map((h) => h.velocity)) : 0;
                const isBeat = i % perBeat === 0;
                const barStart = i > 0 && i % (perBeat * bpb) === 0;
                return (
                  <button
                    key={i}
                    data-step={i} data-lane={laneIndex}
                    className={`step ${hits.some((n) => selected?.includes(n.id)) ? 'note-selected' : ''} ${on ? 'on' : ''} ${isBeat ? 'beat' : ''} ${barStart ? 'bar-start' : ''}`}
                    style={{ ['--c' as string]: track.color, opacity: on ? 0.45 + vel * 0.55 : 1, width: perBeat > 4 ? 14 : 22 }}
                    onClick={(e) => toggle(l.note, i, e)}
                    aria-label={`${l.name} step ${i + 1}${on ? ' on' : ''}`}
                  >
                    {hits.length > 1 ? <span style={{ fontSize: 9, fontWeight: 700, color: '#0b0b0c' }}>{hits.length}</span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {!lanes.length && <div className="dock-empty">This kit has no lanes yet.</div>}
      </div>
    </div>
  );
}
