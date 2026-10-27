import { useLayoutEffect, useRef } from 'react';
import { Ear } from '../icons';
import { useDaw } from '../../state/store';
import type { AudioClip, Project, Track, WarpMode } from '../../model/types';
import { beatsPerBar } from '../../model/project';
import { getSampleMeta, useLibrary } from '../../samples/library';
import { usePeaks } from '../hooks';
import { openInlineAI } from './InlineAI';
import { ParamSlider } from './Inspector';

function Wave({ sampleId, reverse, color }: { sampleId: string; reverse: boolean; color: string }) {
  const peaks = usePeaks(sampleId, reverse);
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv || !peaks) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * devicePixelRatio;
    cv.height = h * devicePixelRatio;
    const g = cv.getContext('2d')!;
    g.scale(devicePixelRatio, devicePixelRatio);
    g.fillStyle = color;
    for (let x = 0; x < w; x++) {
      const v = peaks[Math.floor((x / w) * peaks.length)] * (h / 2 - 2);
      g.fillRect(x, h / 2 - v, 1, Math.max(1, v * 2));
    }
  }, [peaks, color]);
  return <canvas ref={ref} style={{ width: '100%', height: 120, display: 'block', background: 'var(--bg)', borderRadius: 8 }} aria-label="Waveform" />;
}

export function AudioEditor({ clip, track, project }: { clip: AudioClip; track: Track; project: Project }) {
  const update = useDaw((s) => s.update);
  useLibrary((s) => s.samples[clip.sampleId]);
  const meta = getSampleMeta(clip.sampleId);
  const bpb = beatsPerBar(project);
  const edit = (label: string, fn: (c: AudioClip) => void) => update(label, (d) => {
    for (const t of d.tracks) for (const c of t.clips) if (c.id === clip.id && c.type === 'audio') { fn(c); delete c.aiPending; }
  }, { coalesce: true });

  return (
    <div className="inspector">
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <div className="card-head">
          <input type="text" value={clip.name} onChange={(e) => edit('Rename clip', (c) => { c.name = e.target.value; })} aria-label="Clip name" />
          <span className="chip">{meta?.name ?? clip.sampleId}</span>
          {meta?.bpm && <span className="chip">{meta.bpm} BPM</span>}
          {meta?.key && <span className="chip">{meta.key}</span>}
          <div className="spacer" />
          <button className="btn" onClick={() => openInlineAI([clip.id])}><span className="ai-ink">Edit with AI</span></button>
        </div>
        <Wave sampleId={clip.sampleId} reverse={clip.reverse} color={track.color} />
        {meta?.aiDescription && <div className="heard" style={{ margin: 0 }}><div className="heard-label"><Ear size={12} /> What the agent heard</div>{meta.aiDescription}</div>}
      </div>
      <div className="card">
        <div className="card-head">Playback</div>
        <ParamSlider label="Gain (dB)" value={clip.gainDb} min={-36} max={12} step={0.5} onChange={(v) => edit('Clip gain', (c) => { c.gainDb = v; })} />
        <ParamSlider label="Pitch (st)" value={clip.pitch} min={-24} max={24} step={1} onChange={(v) => edit('Clip pitch', (c) => { c.pitch = v; })} />
        <ParamSlider label="Start offset (s)" value={clip.offset} min={0} max={Math.max(0.1, meta?.duration ?? 1)} step={0.01} onChange={(v) => edit('Clip offset', (c) => { c.offset = v; })} />
        <ParamSlider label="Length (bars)" value={Math.round((clip.length / bpb) * 100) / 100} min={0.25} max={64} step={0.25} onChange={(v) => edit('Clip length', (c) => { c.length = v * bpb; })} />
      </div>
      <div className="card">
        <div className="card-head">Time & shape</div>
        <div className="param">
          <span>Warp</span>
          <select value={clip.warp} onChange={(e) => edit('Warp', (c) => { c.warp = e.target.value as WarpMode; })} aria-label="Warp mode" disabled={!meta?.bpm}>
            <option value="off">Off (native speed)</option>
            <option value="resample">Resample (tempo + pitch)</option>
            <option value="stretch">Stretch (keep pitch)</option>
          </select>
          <span />
        </div>
        {!meta?.bpm && <small style={{ color: 'var(--faint)' }}>Warp needs the sample’s tempo. Name files with “120bpm” or ask the agent to analyze it.</small>}
        <label className="toggle"><input type="checkbox" checked={clip.loop} onChange={(e) => edit('Loop clip', (c) => { c.loop = e.target.checked; })} /> Loop to fill the clip</label>
        <label className="toggle"><input type="checkbox" checked={clip.reverse} onChange={(e) => edit('Reverse clip', (c) => { c.reverse = e.target.checked; })} /> Reverse</label>
        <ParamSlider label="Fade in (s)" value={clip.fadeIn} min={0} max={4} step={0.01} onChange={(v) => edit('Fade in', (c) => { c.fadeIn = v; })} />
        <ParamSlider label="Fade out (s)" value={clip.fadeOut} min={0} max={4} step={0.01} onChange={(v) => edit('Fade out', (c) => { c.fadeOut = v; })} />
      </div>
    </div>
  );
}
