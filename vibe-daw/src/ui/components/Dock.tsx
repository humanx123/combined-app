import { useRef, useState } from 'react';
import { ChevronDown } from '../icons';
import { useDaw } from '../../state/store';
import { findClip, findTrack } from '../../model/project';
import { AnnotationsPanel } from './Annotations';
import { PianoRoll } from './PianoRoll';
import { DrumEditor } from './DrumEditor';
import { AudioEditor } from './AudioEditor';
import { Mixer } from './Mixer';
import { TrackInspector } from './Inspector';
import { uiZoom } from '../hooks';

export function Dock() {
  const project = useDaw((s) => s.project);
  const panel = useDaw((s) => s.bottomPanel);
  const open = useDaw((s) => s.bottomOpen);
  const editorClipId = useDaw((s) => s.editorClipId);
  const selectedTrack = useDaw((s) => s.selection.trackId);
  const { setBottom, toggleBottom } = useDaw.getState();
  // Leave the timeline room on short screens (phones, landscape).
  const [height, setHeight] = useState(() => {
    const vh = window.innerHeight / uiZoom();
    return Math.round(Math.max(140, Math.min(300, Math.max(200, vh * 0.4), vh - 190)));
  });
  const drag = useRef<{ y: number; h: number } | null>(null);

  const found = editorClipId ? findClip(project, editorClipId) : undefined;
  const inspectTrack = selectedTrack ? findTrack(project, selectedTrack) ?? null : found?.track ?? null;

  let editor: React.ReactNode = (
    <div className="dock-empty">
      <div>
        <span className="hide-touch">Double-click</span><span className="only-touch">Tap</span> a clip on the timeline to edit it here.<br />
        No clips yet? Select a track and <span className="hide-touch">click</span><span className="only-touch">tap</span> <b>Clips → New clip</b> in the toolbar.
      </div>
    </div>
  );
  if (found) {
    const { clip, track } = found;
    if (clip.type === 'audio') editor = <AudioEditor clip={clip} track={track} project={project} />;
    else if (track.kind === 'drums') editor = <DrumEditor clip={clip} track={track} project={project} />;
    else editor = <PianoRoll clip={clip} track={track} project={project} />;
  }

  return (
    <section className="dock" style={{ height: open ? height : 34 }} aria-label="Editor dock">
      {open && (
        <div
          className="dock-resize"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, h: height };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const z = uiZoom();
            setHeight(Math.max(140, Math.min(window.innerHeight / z - 220, drag.current.h - (e.clientY - drag.current.y) / z)));
          }}
          onPointerUp={() => { drag.current = null; }}
          onPointerCancel={() => { drag.current = null; }}
        />
      )}
      <div className="dock-head">
        <button className={`tab ${panel === 'editor' ? 'active' : ''}`} onClick={() => setBottom('editor')} title="Edit the notes, drum steps, or audio of the selected clip">Clip editor{found && <span className="tab-detail"> · {found.clip.name}</span>}</button>
        <button className={`tab ${panel === 'mixer' ? 'active' : ''}`} onClick={() => setBottom('mixer')} title="Volume, pan, mute and solo for every track">Mixer</button>
        <button className={`tab ${panel === 'track' ? 'active' : ''}`} onClick={() => setBottom('track')} title="Change the selected track's instrument and effects">{inspectTrack ? <>Sound &amp; FX<span className="tab-detail"> · {inspectTrack.name}</span></> : 'Master FX'}</button>
        <button className={`tab ${panel === 'notes' ? 'active' : ''}`} onClick={() => setBottom('notes')}>Notes &amp; lyrics</button>
        <div className="spacer" />
        <button className="btn icon" onClick={toggleBottom} aria-label={open ? 'Collapse dock' : 'Expand dock'} style={{ transform: open ? 'none' : 'rotate(180deg)' }}><ChevronDown size={16} /></button>
      </div>
      {open && (
        <div className="dock-body">
          {panel === 'editor' && editor}
          {panel === 'notes' && <AnnotationsPanel />}
          {panel === 'mixer' && <Mixer />}
          {panel === 'track' && <TrackInspector track={inspectTrack} project={project} />}
        </div>
      )}
    </section>
  );
}
