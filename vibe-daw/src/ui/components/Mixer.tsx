import { memo, useRef } from 'react';
import { useDaw } from '../../state/store';
import type { Track } from '../../model/types';
import { getMasterLevels, getTrackLevel } from '../../engine/api';
import { rangeFill, useAnimationFrame } from '../hooks';

function levelToPct(db: number) {
  if (!isFinite(db)) return 0;
  return Math.max(0, Math.min(100, ((db + 60) / 66) * 100));
}

function Meter({ read }: { read: () => number }) {
  const fill = useRef<HTMLDivElement>(null);
  useAnimationFrame(() => {
    paintMeter(fill.current, read());
  });
  return <div className="meter" aria-hidden><div className="fill" ref={fill} /></div>;
}

const paintedLevels = new WeakMap<HTMLDivElement, number>();

function paintMeter(el: HTMLDivElement | null, db: number) {
  if (!el) return;
  // Clip the full-height gradient so its colors stay fixed as the level moves.
  // Updating height forced layout for every channel on every animation frame.
  const pct = levelToPct(db);
  if (paintedLevels.get(el) === pct) return;
  paintedLevels.set(el, pct);
  el.style.clipPath = `inset(${100 - pct}% 0 0)`;
}

function MasterMeter() {
  const left = useRef<HTMLDivElement>(null), right = useRef<HTMLDivElement>(null);
  useAnimationFrame(() => {
    const levels = getMasterLevels();
    paintMeter(left.current, levels[0]);
    paintMeter(right.current, levels[1]);
  });
  return <>
    <div className="meter" aria-hidden><div className="fill" ref={left} /></div>
    <div className="meter" aria-hidden><div className="fill" ref={right} /></div>
  </>;
}

const Strip = memo(function Strip({ track, selected }: { track: Track; selected: boolean }) {
  const { update, select, setBottom } = useDaw.getState();
  const set = (label: string, fn: (t: Track) => void, coalesce = false) => update(label, (d) => { const t = d.tracks.find((x) => x.id === track.id); if (t) fn(t); }, { coalesce });
  return (
    <div className={`strip ${selected ? 'selected' : ''}`} style={{ ['--c' as string]: track.color }} onPointerDown={() => select({ trackId: track.id })}>
      <div className="sname" title={track.name}>{track.name}</div>
      <button className="fx-count btn" style={{ height: 20, padding: '0 6px' }} title="Open this track's instrument and effects" onClick={() => { select({ trackId: track.id }); setBottom('track'); }}>
        {track.effects.length ? `FX · ${track.effects.length}` : '+ FX'}
      </button>
      <input className="pan" type="range" min={-1} max={1} step={0.01} value={track.pan} style={rangeFill(track.pan, -1, 1)} onChange={(e) => set('Pan', (t) => { t.pan = Number(e.target.value); }, true)} onDoubleClick={() => set('Pan', (t) => { t.pan = 0; })} aria-label={`${track.name} pan`} title={`Pan ${track.pan === 0 ? 'center' : `${Math.round(Math.abs(track.pan) * 100)}% ${track.pan < 0 ? 'left' : 'right'}`} · double-click to center`} />
      <div className="fader-wrap">
        <input className="fader" type="range" min={-60} max={6} step={0.5} value={track.volumeDb} style={rangeFill(track.volumeDb, -60, 6)} onChange={(e) => set('Volume', (t) => { t.volumeDb = Number(e.target.value); }, true)} onDoubleClick={() => set('Volume', (t) => { t.volumeDb = 0; })} aria-label={`${track.name} volume`} title="Volume · double-click to reset to 0 dB" />
        <Meter read={() => getTrackLevel(track.id)} />
      </div>
      <span className="db">{track.volumeDb > 0 ? '+' : ''}{track.volumeDb.toFixed(1)} dB</span>
      <div style={{ display: 'flex', gap: 3 }}>
        <button className={`ms m ${track.mute ? 'on' : ''}`} onClick={() => set('Mute', (t) => { t.mute = !t.mute; })} aria-label="Mute">M</button>
        <button className={`ms s ${track.solo ? 'on' : ''}`} onClick={() => set('Solo', (t) => { t.solo = !t.solo; })} aria-label="Solo">S</button>
      </div>
    </div>
  );
});

export function Mixer() {
  const tracks = useDaw((s) => s.project.tracks);
  const master = useDaw((s) => s.project.master);
  const selected = useDaw((s) => s.selection.trackId);
  const update = useDaw((s) => s.update);
  return (
    <div className="mixer">
      {tracks.map((t) => <Strip key={t.id} track={t} selected={selected === t.id} />)}
      <div className="strip master" onPointerDown={() => useDaw.getState().select({ trackId: null })}>
        <div className="sname">Master</div>
        <span className="fx-count">{master.effects.length} fx</span>
        <div className="fader-wrap">
          <input className="fader" type="range" min={-24} max={6} step={0.5} value={master.volumeDb} style={rangeFill(master.volumeDb, -24, 6)} onChange={(e) => update('Master volume', (d) => { d.master.volumeDb = Number(e.target.value); }, { coalesce: true })} aria-label="Master volume" />
          <MasterMeter />
        </div>
        <span className="db">{master.volumeDb.toFixed(1)} dB</span>
      </div>
      {!tracks.length && <div className="dock-empty" style={{ flex: 1 }}>Add a track to see its channel strip.</div>}
    </div>
  );
}
