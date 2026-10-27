import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Check, CircleAlert, Code, FlaskConical, Plus, Trash, TriangleAlert, X } from '../icons';
import { useDaw } from '../../state/store';
import { findEffect } from '../../model/project';
import { CUSTOM_BLANK, CUSTOM_EFFECT_API, CUSTOM_LIMITS, CUSTOM_STARTERS, rebaseCustomValues, validateCustomEffect } from '../../model/customEffect';
import type { CustomEffectDef } from '../../model/types';
import { checkCustomEffect, type CustomCheck } from '../../engine/customCheck';
import { toast } from '../toast';

const editor = create<{ effectId: string | null }>(() => ({ effectId: null }));
export function openCustomEffectEditor(effectId: string) { editor.setState({ effectId }); }

interface DraftKnob { id: string; label: string; min: string; max: string; default: string }
interface Draft { name: string; description: string; code: string; params: DraftKnob[] }

const toDraft = (def: CustomEffectDef): Draft => ({
  name: def.name, description: def.description ?? '', code: def.code,
  params: def.params.map((k) => ({ id: k.id, label: k.label, min: String(k.min), max: String(k.max), default: String(k.default) })),
});
const fromDraft = (d: Draft): unknown => ({
  name: d.name, description: d.description || undefined, code: d.code,
  params: d.params.map((k) => ({ id: k.id.trim(), label: k.label, min: Number(k.min), max: Number(k.max), default: Number(k.default) })),
});

/** Plain textarea with a line gutter: Tab indents, Shift+Tab outdents. */
function CodeArea({ value, onChange, onSubmit }: { value: string; onChange: (v: string) => void; onSubmit: () => void }) {
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split('\n').length;
  return (
    <div className="code-area">
      <div className="code-gutter" ref={gutter} aria-hidden>{Array.from({ length: lines }, (_, i) => <span key={i}>{i + 1}</span>)}</div>
      <textarea
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-label="Effect code"
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => { if (gutter.current) gutter.current.scrollTop = e.currentTarget.scrollTop; }}
        onKeyDown={(e) => {
          const ta = e.currentTarget;
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); onSubmit(); return; }
          if (e.key !== 'Tab') return;
          e.preventDefault();
          const { selectionStart: start, selectionEnd: end } = ta;
          const lineStart = value.lastIndexOf('\n', start - 1) + 1;
          if (e.shiftKey) {
            const removed = value.slice(lineStart, lineStart + 2).match(/^ {1,2}/)?.[0].length ?? 0;
            if (!removed) return;
            onChange(value.slice(0, lineStart) + value.slice(lineStart + removed));
            requestAnimationFrame(() => ta.setSelectionRange(Math.max(lineStart, start - removed), Math.max(lineStart, end - removed)));
          } else {
            onChange(`${value.slice(0, start)}  ${value.slice(end)}`);
            requestAnimationFrame(() => ta.setSelectionRange(start + 2, start + 2));
          }
        }}
      />
    </div>
  );
}

function Status({ check, busy }: { check: CustomCheck | null; busy: boolean }) {
  if (busy) return <div className="fx-status"><FlaskConical size={13} /> Testing on a chord, noise and silence…</div>;
  if (!check) return <div className="fx-status idle"><FlaskConical size={13} /> Test runs your code in a sandbox before it touches playback. Ctrl+Enter applies.</div>;
  if (!check.ok) return <div className="fx-status bad" role="alert"><CircleAlert size={13} /> <span>{check.error}</span></div>;
  const r = check.result!;
  const db = 20 * Math.log10(r.peak);
  const peak = r.peak > 0 ? `${db > 0 ? '+' : ''}${db.toFixed(1)} dBFS peak` : 'silent';
  return <div className={`fx-status ${check.warnings.length ? 'warn' : 'good'}`} role="status">
    {check.warnings.length ? <TriangleAlert size={13} /> : <Check size={13} />}
    <span>Passed · {peak} · {Math.max(1, Math.round((r.ms / 1000 / r.seconds) * 100))}% CPU{check.warnings.map((w) => <span key={w} className="fx-warning">{w}</span>)}</span>
  </div>;
}

export function CustomEffectEditor() {
  const effectId = editor((s) => s.effectId);
  const effect = useDaw((s) => (effectId ? findEffect(s.project, effectId)?.effect : undefined));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [check, setCheck] = useState<CustomCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  useEffect(() => {
    if (!effectId) return;
    const fx = findEffect(useDaw.getState().project, effectId)?.effect;
    setDraft(toDraft(fx?.custom ?? CUSTOM_BLANK)); setCheck(null); setShowHelp(false);
  }, [effectId]);
  // The effect can disappear underneath (undo, the Producer); close rather than edit nothing.
  useEffect(() => { if (effectId && !effect) editor.setState({ effectId: null }); }, [effectId, effect]);
  if (!effectId || !effect || !draft) return null;

  const close = () => editor.setState({ effectId: null });
  const edit = (patch: Partial<Draft>) => { setDraft({ ...draft, ...patch }); setCheck(null); };
  const editKnob = (i: number, patch: Partial<DraftKnob>) => edit({ params: draft.params.map((k, j) => (j === i ? { ...k, ...patch } : k)) });
  const run = async (): Promise<{ def: CustomEffectDef; check: CustomCheck } | null> => {
    let def: CustomEffectDef;
    try { def = validateCustomEffect(fromDraft(draft)); }
    catch (e) { const failed = { ok: false, error: (e as Error).message, warnings: [] }; setCheck(failed); return null; }
    setBusy(true);
    try {
      const result = await checkCustomEffect(def, rebaseCustomValues(def, effect.params), useDaw.getState().project.bpm);
      setCheck(result);
      return { def, check: result };
    } finally { setBusy(false); }
  };
  const apply = async () => {
    if (busy) return;
    const tested = await run();
    if (!tested?.check.ok) return;
    useDaw.getState().update(`Edit ${tested.def.name}`, (d) => {
      const fx = findEffect(d, effectId)?.effect;
      if (!fx) return;
      fx.custom = tested.def;
      fx.params = rebaseCustomValues(tested.def, fx.params);
    });
    toast(`${tested.def.name} updated`);
    close();
  };

  return <div className="overlay" onPointerDown={(e) => { if (e.currentTarget === e.target && !busy) close(); }}>
    <form
      className="modal custom-fx-editor"
      role="dialog" aria-modal="true" aria-label="Custom effect editor"
      onSubmit={(e) => { e.preventDefault(); void apply(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}
    >
      <header className="custom-fx-head">
        <h2><Code size={18} /> Custom effect</h2>
        <select value="" aria-label="Start from a template" onChange={(e) => {
          const starter = e.target.value === 'blank' ? CUSTOM_BLANK : CUSTOM_STARTERS.find((s) => s.id === e.target.value)?.def;
          if (starter && (draft.code === effect.custom?.code || confirm('Replace your code and knobs with this template?'))) edit(toDraft(starter));
        }}>
          <option value="">Start from…</option>
          <option value="blank">Blank (gain)</option>
          {CUSTOM_STARTERS.map((s) => <option key={s.id} value={s.id}>{s.def.name}</option>)}
        </select>
        <button type="button" className="btn icon" onClick={close} aria-label="Close editor"><X size={16} /></button>
      </header>
      <div className="custom-fx-meta">
        <label className="field"><span>Name</span><input type="text" value={draft.name} maxLength={CUSTOM_LIMITS.name} onChange={(e) => edit({ name: e.target.value })} aria-label="Effect name" required /></label>
        <label className="field"><span>Description</span><input type="text" value={draft.description} maxLength={CUSTOM_LIMITS.description} onChange={(e) => edit({ description: e.target.value })} placeholder="What it does, in one line" aria-label="Effect description" /></label>
      </div>
      <section className="custom-fx-knobs" aria-label="Knobs">
        <div className="custom-fx-section-head"><b>Knobs</b><span>Read in code as <code>params.id</code></span>
          <button type="button" className="btn" disabled={draft.params.length >= CUSTOM_LIMITS.params} onClick={() => edit({ params: [...draft.params, { id: `knob${draft.params.length + 1}`, label: 'Amount', min: '0', max: '1', default: '0.5' }] })}><Plus size={13} /> Add knob</button>
        </div>
        {draft.params.length > 0 && <div className="knob-grid">
          <span>Id</span><span>Label</span><span>Min</span><span>Max</span><span>Default</span><span />
          {draft.params.map((k, i) => <div className="knob-row" key={i}>
            <input value={k.id} onChange={(e) => editKnob(i, { id: e.target.value })} aria-label={`Knob ${i + 1} id`} placeholder="id" className="mono" />
            <input value={k.label} onChange={(e) => editKnob(i, { label: e.target.value })} aria-label={`Knob ${i + 1} label`} placeholder="Label" />
            <input value={k.min} inputMode="decimal" onChange={(e) => editKnob(i, { min: e.target.value })} aria-label={`Knob ${i + 1} minimum`} placeholder="min" className="mono" />
            <input value={k.max} inputMode="decimal" onChange={(e) => editKnob(i, { max: e.target.value })} aria-label={`Knob ${i + 1} maximum`} placeholder="max" className="mono" />
            <input value={k.default} inputMode="decimal" onChange={(e) => editKnob(i, { default: e.target.value })} aria-label={`Knob ${i + 1} default`} placeholder="default" className="mono" />
            <button type="button" className="btn icon danger" onClick={() => edit({ params: draft.params.filter((_, j) => j !== i) })} aria-label={`Remove knob ${k.id}`}><Trash size={13} /></button>
          </div>)}
        </div>}
      </section>
      <section className="custom-fx-code" aria-label="Code">
        <div className="custom-fx-section-head"><b>Code</b><span>JavaScript · runs on the audio thread</span>
          <button type="button" className="btn" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}>{showHelp ? 'Hide reference' : 'Reference'}</button>
        </div>
        {showHelp && <pre className="custom-fx-help">{CUSTOM_EFFECT_API}</pre>}
        <CodeArea value={draft.code} onChange={(code) => edit({ code })} onSubmit={() => void apply()} />
      </section>
      <Status check={check} busy={busy} />
      <div className="modal-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void run()}><FlaskConical size={14} /> Test</button>
        <button type="button" className="btn" disabled={busy} onClick={close}>Cancel</button>
        <button className="btn primary" disabled={busy}>{busy ? 'Testing…' : 'Test & apply'}</button>
      </div>
    </form>
  </div>;
}
