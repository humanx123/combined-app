import { AddToChat } from './AddToChat';
import { useMemo, useRef, useState } from 'react';
import { Play, Trash, Plus, Power, CopyPlus, Bookmark, ChevronUp, ChevronDown, RotateCcw, Code, CircleAlert } from '../icons';
import { openSavePreset } from './SavePreset';
import { useDaw } from '../../state/store';
import { EFFECT_BY_TYPE, PRESETS, PRESET_BY_ID, defaultEffectParams, defaultPresetParams, type EffectInfo } from '../../model/catalog';
import type { Effect, EffectType, Project, Track } from '../../model/types';
import { cloneDeep, mintId } from '../../model/project';
import { useLibrary } from '../../samples/library';
import { previewNote } from '../../engine/api';
import { rangeFill } from '../hooks';
import { CUSTOM_BLANK, CUSTOM_STARTERS, customDefaults, effectName, newCustomEffect } from '../../model/customEffect';
import { useCustomFxErrors } from '../../state/customFxErrors';
import { usePresets } from '../../state/presetLibrary';
import { libraryPlugins, loadFromLibrary } from '../presetActions';
import { openCustomEffectEditor } from './CustomEffectEditor';
import { toast } from '../toast';

/** Unit-aware display for a param label like "Cutoff (Hz)" or "Mix". */
function formatValue(label: string, v: number): string {
  if (/\(Hz\)/.test(label)) return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`;
  if (/\(dB\)/.test(label)) return `${v > 0 ? '+' : ''}${(Math.round(v * 10) / 10).toFixed(1)} dB`;
  if (/\(s\)/.test(label)) return v < 1 ? `${Math.round(v * 1000)} ms` : `${(Math.round(v * 100) / 100).toFixed(2)} s`;
  if (/\(ms\)/.test(label)) return `${Math.round(v * 10) / 10} ms`;
  if (/Mix|Depth|Width|Drive|Feedback|Sustain|Punch|Brightness|Wow|Tone|noise/i.test(label) && v >= 0 && v <= 1) return `${Math.round(v * 100)}%`;
  return String(Math.round(v * 100) / 100);
}

/** Slider plus an exact-value box. Double-click the slider to reset to the default. */
export function ParamSlider({ label, value, min, max, step, onChange, format, defaultValue }: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; defaultValue?: number }) {
  const s = step ?? (max - min > 200 ? 1 : max - min > 20 ? 0.1 : 0.01);
  const [draft, setDraftValue] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  // Blur can follow input/Escape before React commits another render.
  const setDraft = (text: string | null) => { draftRef.current = text; setDraftValue(text); };
  const clamp = (v: number) => Math.max(min, Math.min(max, v));
  const commit = () => {
    const draft = draftRef.current;
    if (draft === null) return;
    const v = Number(draft.replace(/[^\d.+-]/g, ''));
    if (draft.trim() !== '' && isFinite(v)) {
      // Accept "1.2k" style input for Hz, and percentages for 0..1 params.
      let n = v;
      if (/k\s*(hz)?$/i.test(draft.trim()) && /\(Hz\)/.test(label)) n = v * 1000;
      else if (/%$/.test(draft.trim()) && max <= 1) n = v / 100;
      onChange(clamp(n));
    }
    setDraft(null);
  };
  const shown = format ? format(value) : formatValue(label, value);
  return (
    <div className="param">
      <span title={label}>{label.replace(/\s*\((Hz|dB|s|ms)\)/, '')}</span>
      <input
        type="range" min={min} max={max} step={s} value={value} style={rangeFill(value, min, max)}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => defaultValue !== undefined && onChange(defaultValue)}
        aria-label={label}
        title={defaultValue !== undefined ? 'Drag to adjust · double-click to reset' : undefined}
      />
      <input
        className="val-input"
        value={draft ?? shown}
        onFocus={(e) => {
          const raw = String(Math.round(value * 1000) / 1000);
          // Keep the DOM and draft aligned before selecting; a delayed value rewrite
          // can otherwise move the caret and prepend the old value to fast input.
          e.currentTarget.value = raw; setDraft(raw); e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          else if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const n = clamp(value + (e.key === 'ArrowUp' ? 1 : -1) * s * (e.shiftKey ? 10 : 1));
            onChange(n);
            setDraft(String(Math.round(n * 1000) / 1000));
          }
        }}
        aria-label={`${label} value`}
        title="Type an exact value · ↑↓ to nudge (Shift = ×10)"
      />
    </div>
  );
}

/** One-click starting points per effect. */
const FX_PRESETS: Partial<Record<EffectType, Record<string, Record<string, number | string>>>> = {
  reverb: { Room: { decay: 0.9, preDelay: 0.01, wet: 0.2 }, Plate: { decay: 1.8, preDelay: 0.02, wet: 0.28 }, Hall: { decay: 3.5, preDelay: 0.03, wet: 0.32 }, Huge: { decay: 8, preDelay: 0.05, wet: 0.45 } },
  delay: { Slapback: { time: '32n', feedback: 0.1, wet: 0.2, pingPong: 0 }, Eighth: { time: '8n', feedback: 0.3, wet: 0.22, pingPong: 1 }, Dotted: { time: '8n.', feedback: 0.4, wet: 0.25, pingPong: 1 }, Dub: { time: '4n', feedback: 0.65, wet: 0.35, pingPong: 0 } },
  compressor: { Glue: { threshold: -18, ratio: 2, attack: 0.03, release: 0.25, makeup: 2 }, Punch: { threshold: -20, ratio: 4, attack: 0.02, release: 0.1, makeup: 4 }, Squash: { threshold: -30, ratio: 10, attack: 0.002, release: 0.08, makeup: 8 } },
  eq: { Flat: { low: 0, mid: 0, high: 0 }, 'Clear mud': { low: -3, mid: -4, high: 1 }, Air: { low: 0, mid: 0, high: 4 }, 'Thin out': { low: -10, mid: 0, high: 2 } },
  filter: { Muffled: { mode: 'lowpass', frequency: 700, q: 1 }, Telephone: { mode: 'bandpass', frequency: 1500, q: 2 }, 'Clean lows': { mode: 'highpass', frequency: 150, q: 0.7 } },
  lofi: { Tape: { wow: 0.25, tone: 0.55, noise: 0.05, wet: 1 }, Vinyl: { wow: 0.35, tone: 0.4, noise: 0.35, wet: 1 }, Broken: { wow: 0.9, tone: 0.2, noise: 0.5, wet: 1 } },
  distortion: { Warm: { amount: 0.2, wet: 0.6 }, Crunch: { amount: 0.5, wet: 1 }, Blown: { amount: 0.9, wet: 1 } },
  chorus: { Subtle: { frequency: 0.8, depth: 0.3, wet: 0.3 }, Lush: { frequency: 1.5, depth: 0.7, wet: 0.5 }, Wobble: { frequency: 4, depth: 0.9, wet: 0.7 } },
};

const FX_GROUPS: Array<[string, EffectType[]]> = [
  ['Tone', ['eq', 'parametric_eq', 'filter']],
  ['Dynamics', ['compressor', 'limiter', 'duck']],
  ['Space', ['reverb', 'delay', 'widener']],
  ['Color', ['saturation', 'distortion', 'bitcrusher', 'lofi']],
  ['Modulation', ['chorus', 'phaser', 'tremolo']],
];

function EffectCard({ fx, index, count, onChange, onRemove, onMove, onDuplicate, project }: { fx: Effect; index: number; count: number; onChange: (fn: (e: Effect) => void) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void; onDuplicate: () => void; project: Project }) {
  const info = EFFECT_BY_TYPE[fx.type];
  const name = effectName(fx);
  const presets = FX_PRESETS[fx.type];
  const custom = fx.type === 'custom' ? fx.custom : undefined;
  const liveError = useCustomFxErrors((s) => s[fx.id]);
  const knobs: EffectInfo['params'] = custom ? Object.fromEntries(custom.params.map((k) => [k.id, { default: k.default, min: k.min, max: k.max, label: k.label }])) : info.params;
  return (
    <div data-chat-ref={`effect:${fx.id}`} className={`card fx-card ${fx.enabled ? '' : 'bypassed'}`}>
      <div className="card-head">
        <button className={`fx-power ${fx.enabled ? 'on' : ''}`} onClick={() => onChange((x) => { x.enabled = !x.enabled; })} title={fx.enabled ? 'Bypass this effect' : 'Turn this effect back on'} aria-pressed={fx.enabled}>
          <Power size={12} />
        </button>
        <span className="fx-name" title={custom?.description ?? info.description}>{name}</span>
        <AddToChat referenceId={`effect:${fx.id}`} label={name} />
        <div className="spacer" />
        <button className="btn icon" disabled={index === 0} onClick={() => onMove(-1)} title="Move earlier in the chain" aria-label="Move up"><ChevronUp size={13} /></button>
        <button className="btn icon" disabled={index === count - 1} onClick={() => onMove(1)} title="Move later in the chain" aria-label="Move down"><ChevronDown size={13} /></button>
        <button className="btn icon" onClick={() => onChange((x) => { x.params = x.custom ? customDefaults(x.custom) : { ...defaultEffectParams(x.type), ...(x.type === 'duck' ? { source: x.params.source } : {}) }; })} title="Reset all settings" aria-label="Reset"><RotateCcw size={12} /></button>
        <button className="btn icon" onClick={onDuplicate} title="Duplicate effect with its settings" aria-label={`Duplicate ${name}`}><CopyPlus size={13} /></button>
        <button className="btn icon danger" onClick={onRemove} title="Remove this effect" aria-label={`Remove ${name}`}><Trash size={13} /></button>
      </div>
      {presets && (
        <select
          className="fx-preset"
          value=""
          onChange={(e) => { const pr = presets[e.target.value]; if (pr) onChange((x) => { x.params = { ...x.params, ...pr }; }); }}
          aria-label={`${info.name} preset`}
          title="Load a preset"
        >
          <option value="">Presets…</option>
          {Object.keys(presets).map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      )}
      {custom && <div className="fx-custom-row">
        <button className="btn solid" onClick={() => openCustomEffectEditor(fx.id)}><Code size={13} /> Edit code</button>
        <button className="btn" onClick={() => openSavePreset({ kind: 'effects', name: custom.name, effectId: fx.id })}><Bookmark size={13} /> Save as plugin</button>
      </div>}
      {custom && liveError && <div className="fx-error" role="alert"><CircleAlert size={13} /><span>{liveError}<small>Bypassed until the code is fixed.</small></span></div>}
      {custom && !custom.params.length && <small className="fx-hint">No knobs. Add some in the editor.</small>}
      {Object.entries(knobs).map(([k, spec]) => {
        const v = fx.params[k] ?? spec.default;
        if (k === 'source') {
          return (
            <div className="param" key={k}>
              <span>Trigger</span>
              <select value={String(v)} onChange={(e) => onChange((x) => { x.params.source = e.target.value; })} aria-label="Duck trigger track">
                <option value="">Choose track…</option>
                {project.tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <span />
            </div>
          );
        }
        if (spec.options) {
          return (
            <div className="param" key={k}>
              <span>{spec.label}</span>
              <select value={String(v)} onChange={(e) => onChange((x) => { x.params[k] = e.target.value; })} aria-label={spec.label}>
                {spec.options.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
              <span />
            </div>
          );
        }
        return <ParamSlider key={k} label={spec.label} value={Number(v)} min={spec.min ?? 0} max={spec.max ?? 1} defaultValue={Number(spec.default)} onChange={(nv) => onChange((x) => { x.params[k] = nv; })} />;
      })}
    </div>
  );
}

export function EffectChain({ ownerId, effects, project }: { ownerId: string | 'master'; effects: Effect[]; project: Project }) {
  const update = useDaw((s) => s.update);
  const records = usePresets((s) => s.records);
  const plugins = useMemo(() => libraryPlugins(records), [records]);
  const list = (d: Project) => (ownerId === 'master' ? d.master.effects : d.tracks.find((t) => t.id === ownerId)!.effects);
  /** Append, keeping a master limiter last. Returns the new effect's id. */
  const insert = (label: string, make: (d: Project) => Effect) => {
    let id = '';
    update(label, (d) => {
      const l = list(d), fx = make(d);
      id = fx.id;
      if (ownerId === 'master' && l.length && l[l.length - 1].type === 'limiter' && fx.type !== 'limiter') l.splice(l.length - 1, 0, fx);
      else l.push(fx);
    });
    return id;
  };
  return (
    <>
      <div className="library-chain-save"><button className="btn" disabled={!effects.length} onClick={() => openSavePreset({ kind: 'effects', name: `${ownerId === 'master' ? 'Master' : project.tracks.find((t) => t.id === ownerId)?.name ?? 'Track'} effects`, trackId: ownerId })}><Bookmark size={13} /> Save effect profile</button></div>
      {effects.map((fx, i) => (
        <EffectCard
          key={fx.id}
          fx={fx}
          index={i}
          count={effects.length}
          project={project}
          onChange={(fn) => update(`Edit ${effectName(fx)}`, (d) => { const e = list(d).find((x) => x.id === fx.id); if (e) fn(e); }, { coalesce: true })}
          onDuplicate={() => update('Duplicate effect', (d) => {
            const l = list(d); const at = l.findIndex((x) => x.id === fx.id);
            if (at >= 0) l.splice(at + 1, 0, { ...cloneDeep(l[at]), id: mintId(d, 'fx') });
          })}
          onRemove={() => update('Remove effect', (d) => { const l = list(d); l.splice(l.findIndex((x) => x.id === fx.id), 1); })}
          onMove={(dir) => update('Reorder effects', (d) => {
            const l = list(d);
            const at = l.findIndex((x) => x.id === fx.id);
            const to = at + dir;
            if (to < 0 || to >= l.length) return;
            [l[at], l[to]] = [l[to], l[at]];
          })}
        />
      ))}
      <div className="card add-fx">
        <div className="card-head"><Plus size={14} /> Add effect</div>
        <select
          value=""
          onChange={(e) => {
            const value = e.target.value;
            const [kind, id] = value.split(':');
            if (Object.hasOwn(EFFECT_BY_TYPE, value)) {
              const type = value as EffectType;
              insert(`Add ${EFFECT_BY_TYPE[type].name}`, (d) => ({ id: mintId(d, 'fx'), type, enabled: true, params: defaultEffectParams(type) }));
            } else if (kind === 'custom') {
              const def = id === 'new' ? CUSTOM_BLANK : CUSTOM_STARTERS.find((s) => s.id === id)?.def;
              if (!def) return;
              const fxId = insert(`Add ${def.name}`, (d) => newCustomEffect(mintId(d, 'fx'), def));
              if (id === 'new' && fxId) openCustomEffectEditor(fxId);
            } else if (kind === 'plugin') {
              const record = usePresets.getState().records[id];
              if (record) void loadFromLibrary(record, { targetTrackId: ownerId }).then(() => toast(`Added ${record.name}`)).catch((err) => toast((err as Error).message, 'error'));
            }
          }}
          aria-label="Add effect"
        >
          <option value="">Choose an effect…</option>
          {FX_GROUPS.map(([g, types]) => (
            <optgroup key={g} label={g}>
              {types.map((t) => <option key={t} value={t}>{EFFECT_BY_TYPE[t].name}</option>)}
            </optgroup>
          ))}
          <optgroup label="Custom">
            <option value="custom:new">New custom effect…</option>
            {CUSTOM_STARTERS.map((s) => <option key={s.id} value={`custom:${s.id}`}>{s.def.name}</option>)}
          </optgroup>
          {plugins.length > 0 && <optgroup label="Your plugins">
            {plugins.map((r) => <option key={r.id} value={`plugin:${r.id}`}>{r.name}</option>)}
          </optgroup>}
        </select>
        <small style={{ color: 'var(--faint)' }}>Effects run top to bottom. Use the arrows to reorder.</small>
      </div>
    </>
  );
}

function DrumKit({ track }: { track: Track }) {
  const update = useDaw((s) => s.update);
  const samples = useLibrary((s) => s.samples);
  const options = useMemo(() => Object.values(samples).filter((m) => m.kind === 'oneshot' || m.duration < 3).sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name)), [samples]);
  const setLane = (id: string, fn: (l: NonNullable<Track['drumLanes']>[number]) => void) => update('Edit drum lane', (d) => {
    const l = d.tracks.find((t) => t.id === track.id)?.drumLanes?.find((x) => x.id === id);
    if (l) fn(l);
  }, { coalesce: true });
  return (
    <div className="card wide">
      <div className="card-head">Drum kit</div>
      {(track.drumLanes ?? []).map((l) => (
        <div className="lane-row" key={l.id}>
          <b>{l.name}</b>
          <select value={l.sampleId} onChange={(e) => setLane(l.id, (x) => { x.sampleId = e.target.value; })} aria-label={`${l.name} sample`}>
            {!samples[l.sampleId] && <option value={l.sampleId}>{l.sampleId}</option>}
            {options.map((m) => <option key={m.id} value={m.id}>{m.category} · {m.name}</option>)}
          </select>
          <input type="number" step={0.5} value={l.gainDb} onChange={(e) => setLane(l.id, (x) => { x.gainDb = Number(e.target.value); })} aria-label={`${l.name} gain dB`} title="Gain dB" />
          <button className="btn icon" onClick={() => previewNote(track.id, l.note, 0.9)} aria-label={`Preview ${l.name}`}><Play size={11} /></button>
        </div>
      ))}
    </div>
  );
}

export function TrackInspector({ track, project }: { track: Track | null; project: Project }) {
  const update = useDaw((s) => s.update);
  if (!track) {
    return (
      <div className="inspector">
        <div className="card" style={{ gridColumn: '1 / -1' }}>
          <div className="card-head">Master bus</div>
          <ParamSlider label="Volume (dB)" value={project.master.volumeDb} min={-24} max={6} step={0.5} onChange={(v) => update('Master volume', (d) => { d.master.volumeDb = v; }, { coalesce: true })} />
        </div>
        <EffectChain ownerId="master" effects={project.master.effects} project={project} />
      </div>
    );
  }
  const preset = track.instrument ? PRESET_BY_ID[track.instrument.preset] : null;
  const setTrack = (label: string, fn: (t: Track) => void) => update(label, (d) => { const t = d.tracks.find((x) => x.id === track.id); if (t) fn(t); }, { coalesce: true });
  return (
    <div className="inspector">
      <div className="library-chain-save"><button className="btn" onClick={() => openSavePreset({ kind: 'sound', name: track.name, trackId: track.id })}><Bookmark size={13} /> Save track sound</button></div>
      {track.kind === 'instrument' && track.instrument && (
        <div className="card">
          <div className="card-head">Instrument</div>
          <select
            value={track.instrument.preset}
            onChange={(e) => setTrack('Change instrument', (t) => { t.instrument = { preset: e.target.value, params: defaultPresetParams(e.target.value) }; })}
            aria-label="Instrument preset"
          >
            {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {preset && <small style={{ color: 'var(--faint)' }}>{preset.description}</small>}
          {preset && Object.entries(preset.params).map(([k, spec]) => (
            <ParamSlider key={k} label={spec.label} value={track.instrument!.params[k] ?? spec.default} min={spec.min} max={spec.max} defaultValue={spec.default} onChange={(v) => setTrack('Instrument param', (t) => { t.instrument!.params[k] = v; })} />
          ))}
        </div>
      )}
      {track.kind === 'drums' && <DrumKit track={track} />}
      <EffectChain ownerId={track.id} effects={track.effects} project={project} />
    </div>
  );
}
