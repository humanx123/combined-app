import { useEffect, useRef } from 'react';
import { KEYS, CHORD_STYLE_OPTIONS } from '@gesto/chords';
import { HAND_CONNECTIONS } from '@gesto/handTracker';
import type { HarmonyMode, StyleMode } from '@gesto/chordReader';
import { PRESETS } from '../../model/catalog';
import { formatPosition } from '../../model/project';
import { useDaw, useTransport } from '../../state/store';
import { useAgent } from '../../agent/agent';
import {
  cameraVideo, isPlayable, latestFrame, newGestoTrack, setPreset, setTrack, startCamera, startKeyboard,
  startRecording, stopInput, stopRecording, toggleJam, useGesto,
} from '../../gesto/session';
import { BASS_STYLES, GROOVES, type BassStyle, type Groove } from '../../gesto/band';
import { Square, LoaderCircle, Metronome, Piano, CircleAlert, Play, Drum } from '../icons';

// Gesto mode: the third way to make music in the studio, next to the Producer's Agent and Ask.
// Hands in front of the camera (or Gesture Synth's keys) play chords on a track; Record
// captures them live as a MIDI clip, with the chord style, octave, arpeggio and bass you set.

const PLAYABLE_FAMILIES = ['pad', 'keys', 'synth', 'orchestral', 'mallet', 'lead', 'guitar'] as const;
const FAMILY_LABEL: Record<(typeof PLAYABLE_FAMILIES)[number], string> = {
  pad: 'Pads', keys: 'Keys', synth: 'Synths', orchestral: 'Orchestral', mallet: 'Mallets', lead: 'Leads', guitar: 'Guitars',
};
const ARP_OPTIONS: Array<[number, string]> = [[0, 'Off (hold chords)'], [0.5, '1/8'], [0.25, '1/16'], [0.125, '1/32']];
const QUANTIZE_OPTIONS: Array<[number, string]> = [[0, 'Off (as played)'], [0.25, '1/16'], [0.5, '1/8'], [1, '1/4'], [4, 'Bar']];

function Stage() {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const input = useGesto((s) => s.input);
  const status = useGesto((s) => s.status);

  // The camera's <video> lives in the session (so a take survives switching tabs); show it here.
  useEffect(() => {
    const v = cameraVideo();
    v.className = 'gesto-video';
    holder.current?.prepend(v);
    return () => { v.remove(); };
  }, []);

  // Skeleton overlay, mirrored like the video.
  useEffect(() => {
    if (input !== 'camera') return;
    let raf = 0;
    const draw = () => {
      const c = canvas.current, v = cameraVideo();
      const ctx = c?.getContext('2d');
      if (c && ctx && v.videoWidth) {
        if (c.width !== v.videoWidth) { c.width = v.videoWidth; c.height = v.videoHeight; }
        holder.current?.style.setProperty('aspect-ratio', `${v.videoWidth} / ${v.videoHeight}`);
        ctx.clearRect(0, 0, c.width, c.height);
        const frame = latestFrame();
        for (const hand of [frame?.left, frame?.right]) {
          if (!hand) continue;
          ctx.strokeStyle = hand === frame?.left ? '#b69cff' : '#ff8fcf';
          ctx.fillStyle = ctx.strokeStyle;
          ctx.lineWidth = Math.max(2, c.width / 220);
          const pt = (i: number) => [hand.landmarks[i].x * c.width, hand.landmarks[i].y * c.height] as const;
          for (const [a, b] of HAND_CONNECTIONS) {
            if (!hand.landmarks[a] || !hand.landmarks[b]) continue;
            ctx.beginPath(); ctx.moveTo(...pt(a)); ctx.lineTo(...pt(b)); ctx.stroke();
          }
          for (let i = 0; i < hand.landmarks.length; i++) { ctx.beginPath(); ctx.arc(...pt(i), ctx.lineWidth * 1.4, 0, Math.PI * 2); ctx.fill(); }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [input]);

  return (
    <div className={`gesto-stage ${input === 'camera' ? 'live' : ''}`} ref={holder}>
      <canvas ref={canvas} className="gesto-overlay" aria-hidden />
      {input !== 'camera' && (
        <div className="gesto-stage-empty">
          {input === 'keyboard' ? <><Piano size={22} /><span>Keyboard on: 1–7 play degrees I–VII, [ ] minor/major, 8 9 0 - chord style, Shift octave down.</span></>
            : <span>Play pads with your hands. Left hand picks the chord, right hand the style, loudness and octave.</span>}
        </div>
      )}
      {status === 'loading' && <div className="gesto-stage-empty"><LoaderCircle size={20} className="spin" /><span>Loading hand tracking…</span></div>}
      <ChordBadge />
    </div>
  );
}

function ChordBadge() {
  const chord = useGesto((s) => s.chord);
  const volume = useGesto((s) => s.volume);
  const input = useGesto((s) => s.input);
  if (input === 'off') return null;
  return (
    <div className={`gesto-chord ${chord ? 'on' : ''}`} aria-live="polite">
      <b>{chord ?? '—'}</b>
      <span className="gesto-meter" aria-hidden><span style={{ width: `${Math.round(volume * 100)}%` }} /></span>
    </div>
  );
}

function RecordBar() {
  const input = useGesto((s) => s.input);
  const recording = useGesto((s) => s.recording);
  const captured = useGesto((s) => s.captured);
  const agentRunning = useAgent((s) => s.running);
  const position = useTransport((s) => s.position);
  const playing = useTransport((s) => s.playing);
  const bandLive = useGesto((s) => s.bandLive);
  const project = useDaw((s) => s.project);
  return (
    <div className="gesto-rec">
      {!recording && (
        <button className="btn gesto-rec-btn" onClick={() => void toggleJam()} title={playing ? 'Stop the song' : 'Play the song and jam (nothing is recorded)'}>
          {playing ? <><Square size={12} /> Stop</> : <><Play size={12} /> Jam</>}
        </button>
      )}
      {recording ? (
        <button className="btn gesto-rec-btn on" onClick={() => stopRecording()}><Square size={12} /> Stop and keep</button>
      ) : (
        <button className="btn gesto-rec-btn" disabled={input === 'off' || agentRunning} onClick={() => void startRecording()}
          title={agentRunning ? 'Wait for the Producer to finish' : input === 'off' ? 'Turn on the camera or keyboard first' : 'Starts the song and records what you play'}>
          <span className="rec-dot" aria-hidden /> Record live
        </button>
      )}
      <span className="gesto-rec-status" role="status">
        {recording ? <><span className="rec-dot" /> {captured} chord{captured === 1 ? '' : 's'} · {formatPosition(project, position)}</>
          : bandLive ? <><Drum size={13} /> Band playing</> : 'Takes land as MIDI clips you can edit.'}
      </span>
    </div>
  );
}

const BASS_PRESETS = PRESETS.filter((p) => p.family === 'bass');

/** Live band: drums and a bass that follow the chord in your hands, recorded with the pads. */
function BandSettings() {
  const s = useGesto((x) => x.settings);
  const set = useGesto((x) => x.setSettings);
  const groove = GROOVES.find((g) => g.id === s.groove);
  return (
    <div className="gesto-band">
      <label className="toggle">
        <input type="checkbox" checked={s.band} onChange={(e) => set({ band: e.target.checked })} />
        <span>Live band<small>Drums and a bass line that follow your chords in time with the song. Record live writes them as clips next to your pads.</small></span>
      </label>
      {s.band && (
        <div className="gesto-settings">
          <label className="field">
            <span>Groove</span>
            <select value={s.groove} onChange={(e) => set({ groove: e.target.value as Groove })}>
              {GROOVES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              <option value="off">No drums</option>
            </select>
          </label>
          <label className="field">
            <span>Bass</span>
            <select value={s.bassStyle} onChange={(e) => set({ bassStyle: e.target.value as BassStyle })}>
              {BASS_STYLES.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Bass sound</span>
            <select value={s.bassPreset ?? ''} onChange={(e) => set({ bassPreset: e.target.value || null })}>
              <option value="">{`Groove's own (${BASS_PRESETS.find((p) => p.id === groove?.bassPreset)?.name ?? 'bass'})`}</option>
              {BASS_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div className="gesto-toggles">
            <label className="toggle"><input type="checkbox" checked={s.percussion} onChange={(e) => set({ percussion: e.target.checked })} /><span>Percussion</span></label>
          </div>
        </div>
      )}
    </div>
  );
}

function Settings() {
  const s = useGesto((x) => x.settings);
  const set = useGesto((x) => x.setSettings);
  const trackId = useGesto((x) => x.trackId);
  const tracks = useDaw((x) => x.project.tracks);
  const metronome = useTransport((x) => x.metronome);
  const playable = tracks.filter(isPlayable);
  const target = playable.find((t) => t.id === trackId);
  return (
    <div className="gesto-settings">
      <label className="field">
        <span>Track</span>
        <select value={target?.id ?? ''} onChange={(e) => (e.target.value === '__new' ? newGestoTrack() : setTrack(e.target.value))}>
          {!target && <option value="">New “Gesto” track</option>}
          {playable.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          <option value="__new">+ New Gesto track</option>
        </select>
      </label>
      <label className="field">
        <span>Sound</span>
        <select value={target?.instrument?.preset ?? 'pad'} onChange={(e) => setPreset(e.target.value)}>
          {PLAYABLE_FAMILIES.map((f) => (
            <optgroup key={f} label={FAMILY_LABEL[f]}>
              {PRESETS.filter((p) => p.family === f).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Key</span>
        <select value={s.keyOffset} onChange={(e) => set({ keyOffset: Number(e.target.value) })}>
          {KEYS.map((k) => <option key={k.midi} value={k.midi}>{k.name}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Left hand</span>
        <select value={s.harmony} onChange={(e) => set({ harmony: e.target.value as HarmonyMode })}>
          <option value="diatonicMajor">Major scale chords</option>
          <option value="diatonicMinor">Minor scale chords</option>
          <option value="tilt">Wrist tilt: major / minor</option>
        </select>
      </label>
      <label className="field wide">
        <span>Right hand</span>
        <select value={s.style} onChange={(e) => set({ style: e.target.value as StyleMode })}>
          <option value="fingers">Fingers: 1 triad · 2 inversion · 3 seventh · 4 ninth</option>
          {CHORD_STYLE_OPTIONS.map((o) => <option key={o.id} value={o.id}>{`Always ${o.label.toLowerCase()}`}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Octave</span>
        <select value={s.octave} onChange={(e) => set({ octave: Number(e.target.value) })}>
          {[-2, -1, 0, 1, 2].map((o) => <option key={o} value={o}>{o > 0 ? `+${o}` : o}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Arpeggio</span>
        <select value={s.arp} onChange={(e) => set({ arp: Number(e.target.value) })}>
          {ARP_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Quantize takes</span>
        <select value={s.quantize} onChange={(e) => set({ quantize: Number(e.target.value) })}>
          {QUANTIZE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <div className="gesto-toggles">
        <label className="toggle"><input type="checkbox" checked={s.bass} onChange={(e) => set({ bass: e.target.checked })} /><span>Auto bass</span></label>
        <label className="toggle"><input type="checkbox" checked={metronome} onChange={(e) => useTransport.getState().setMetronome(e.target.checked)} /><span><Metronome size={13} /> Metronome</span></label>
      </div>
    </div>
  );
}

export function GestoPanel({ hidden }: { hidden: boolean }) {
  const input = useGesto((s) => s.input);
  const error = useGesto((s) => s.error);
  // Leaving the studio turns the camera off and keeps any take in progress.
  useEffect(() => () => stopInput(), []);
  return (
    <div className="gesto" hidden={hidden}>
      <Stage />
      <div className="gesto-inputs" role="radiogroup" aria-label="Gesto input">
        <button className={`btn ${input === 'camera' ? 'solid on' : ''}`} role="radio" aria-checked={input === 'camera'} onClick={() => void startCamera()}>Camera</button>
        <button className={`btn ${input === 'keyboard' ? 'solid on' : ''}`} role="radio" aria-checked={input === 'keyboard'} onClick={startKeyboard}>Keyboard</button>
        <button className={`btn ${input === 'off' ? 'solid' : ''}`} role="radio" aria-checked={input === 'off'} onClick={stopInput}>Off</button>
      </div>
      {error && <div className="err gesto-err"><CircleAlert size={14} /> {error}</div>}
      <RecordBar />
      <BandSettings />
      <Settings />
      <details className="gesto-help">
        <summary>How to play</summary>
        <p><b>Left hand</b>: 1–5 fingers play degrees I–V; index + pinky is VI, add the thumb for VII. A fist mutes.</p>
        <p><b>Right hand</b>: finger count picks the chord style, height sets loudness (recorded as velocity), thumb out drops an octave.</p>
        <p>Both hands must be in view to sound. With the live band on, the bass follows the root of the chord you hold and changes with you.</p>
        <p>While you record, the clips grow bar by bar (dimmed until you stop). Takes that would land on another clip go to a new Gesto track with the same sound. One undo removes the whole take.</p>
      </details>
    </div>
  );
}
