import { useEffect, useRef, useState } from 'react';
import { Trash, Plus, Copy, Cloud, LogOut, RotateCcw } from '../icons';
import { useSettings, MODELS, MAX_CUSTOM_INSTRUCTIONS, type Thinking, GROQ_MODELS } from '../../state/settings';
import { firebaseConfigured, hostedAiEnabled } from '../../cloud/config';
import { useAuth, signIn, signOut, deleteAccount } from '../../cloud/cloud';
import {NativeHapticsControl} from './NativeHapticsControl';
import { usePersist, openProject, newProject, deleteProject, duplicateProject, syncNow } from '../../state/persistence';
import { useDaw } from '../../state/store';
import { rangeFill, relativeTime } from '../hooks';
import { toast } from '../toast';
import { ACTIONS, bindings, comboFromEvent, useKeymap, type ActionId } from '../../state/keymap';
import { THEMES, flowSeconds, useTheme, type ThemeId } from '../../state/theme';
import { accentFill } from '../../state/accent';
import { AccentPicker } from './AccentPicker';
import { importMidiFile } from '../midiActions';
import { openSavePreset } from './SavePreset';
import { importProjectFile } from '../../state/projectFile';
import { acknowledgeAi, hasAiConsent } from '../../legal/acceptance';

function Modal({ title, sub, onClose, children, className = '' }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className={`overlay ${className}`} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {sub && <p className="sub">{sub}</p>}
        {children}
      </div>
    </div>
  );
}

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'ai' | 'appearance' | 'keyboard' | 'playback'>('ai');
  return (
    <Modal title="Settings" onClose={onClose}>
      <div className="tabs settings-tabs" role="tablist">
        {([['ai', 'AI'], ['appearance', 'Appearance'], ['keyboard', 'Keyboard'], ['playback', 'Playback & editing']] as const).map(([id, label]) => (
          <button key={id} className={`tab ${tab === id ? 'active' : ''}`} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      <div className="settings-body">
        {tab === 'ai' && <AiSettings />}
        {tab === 'appearance' && <AppearanceSettings />}
        {tab === 'keyboard' && <KeyboardSettings />}
        {tab === 'playback' && <PlaybackSettings />}
      </div>
      <nav className="legal-links" aria-label="Legal"><a href="/terms/" target="_blank" rel="noopener noreferrer">Terms of Service</a><a href="/privacy/" target="_blank" rel="noopener noreferrer">Privacy Policy</a></nav>
      <div className="modal-actions"><button className="btn primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

function AiSettings() {
  const s = useSettings();
  const user = useAuth((x) => x.user);
  const [key, setKey] = useState(s.apiKey);
  const [groqKey, setGroqKey] = useState(s.groqKey);
  const [groqModel, setGroqModel] = useState(s.groqModel);
  const [aiConsent, setAiConsent] = useState(hasAiConsent);
  const groq = s.provider === 'groq';
  // Pick up a key that arrives from another signed-in device while Settings is open.
  useEffect(() => { setKey(s.apiKey); }, [s.apiKey]);
  useEffect(() => { setGroqKey(s.groqKey); setGroqModel(s.groqModel); }, [s.groqKey, s.groqModel]);
  return (
    <>
      <div className="field">
        <span>AI provider</span>
        <div className="radio-cards">
          <button className={`radio-card ${!groq ? 'on' : ''}`} onClick={() => s.set({ provider: 'gemini' })}>
            <b>Gemini</b>
            <span>Google. Hears your mix and samples.</span>
          </button>
          <button className={`radio-card ${groq ? 'on' : ''}`} onClick={() => s.set({ provider: 'groq' })}>
            <b>Groq</b>
            <span>Fast open models. Composes and edits; cannot listen.</span>
          </button>
        </div>
      </div>
      {groq && (
        <>
          <label className="field">
            <span>Groq API key</span>
            <input type="password" value={groqKey} onChange={(e) => setGroqKey(e.target.value)} onBlur={() => s.set({ groqKey: groqKey.trim() })} placeholder="gsk_…" autoComplete="off" spellCheck={false} />
            <small>Get a free key at <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">console.groq.com/keys</a>. Saved only in this browser and sent only to Groq.</small>
          </label>
          <label className="field">
            <span>Groq model</span>
            <input list="groq-models" value={groqModel} onChange={(e) => setGroqModel(e.target.value)} onBlur={() => s.set({ groqModel: groqModel.trim() })} autoComplete="off" spellCheck={false} />
            <datalist id="groq-models">
              {GROQ_MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} - {m.blurb}</option>)}
            </datalist>
            <small>Pick a suggestion or type any model id from <a href="https://console.groq.com/docs/models" target="_blank" rel="noreferrer">Groq's model list</a>. Voice messages are transcribed with Groq Whisper.</small>
          </label>
        </>
      )}
      {!groq && hostedAiEnabled && (
        <div className="field">
          <span>Connection</span>
          <div className="radio-cards">
            <button className={`radio-card ${s.connection === 'firebase' ? 'on' : ''}`} onClick={() => s.set({ connection: 'firebase' })}>
              <b>Vibe cloud</b>
              <span>Gemini through Firebase AI Logic. No key needed.</span>
            </button>
            <button className={`radio-card ${s.connection === 'apikey' ? 'on' : ''}`} onClick={() => s.set({ connection: 'apikey' })}>
              <b>Your Gemini key</b>
              <span>Calls Google directly from this browser.</span>
            </button>
          </div>
        </div>
      )}
      {!groq && <label className="field">
        <span>Gemini API key</span>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} onBlur={() => s.set({ apiKey: key.trim() })} placeholder="AIza…" autoComplete="off" spellCheck={false} />
        <small>
          Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a>.
          {user ? 'Saved in this browser and synced to your account so your other devices have it. Only sent to Google.' : 'Saved only in this browser and sent only to Google.'}
        </small>
      </label>}
      <div className="ai-data-notice">
        <strong>Before using AI</strong>
        {groq && <p>With Groq selected, prompts, project details, instructions and voice messages go to Groq instead, under <a href="https://groq.com/terms-of-use" target="_blank" rel="noopener noreferrer">Groq's terms</a>.</p>}
        {!groq && <p>Prompts, project details, instructions, and audio you attach or let the agent listen to go to Google. Voice messages include your recording. Unpaid Gemini requests may be reviewed by people and used to improve Google products. Avoid personal, confidential, or sensitive material.</p>}
        <label className="toggle"><input type="checkbox" checked={aiConsent} onChange={event => { acknowledgeAi(event.target.checked); setAiConsent(hasAiConsent()); }} /><span>I am 18 or older, agree to Vibe's <a href="/terms/" target="_blank" rel="noopener noreferrer">Terms</a>, acknowledge its <a href="/privacy/" target="_blank" rel="noopener noreferrer">Privacy Policy</a>, and will use Gemini for professional or business purposes in a <a href="https://ai.google.dev/gemini-api/docs/available-regions" target="_blank" rel="noopener noreferrer">supported region</a>. I understand the data notice and will use a billing-enabled Google project if I am in the EEA, UK, or Switzerland. <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener noreferrer">Google's AI terms</a></span></label>
      </div>
      {!groq && <label className="field">
        <span>Model</span>
        <select value={s.model} onChange={(e) => s.set({ model: e.target.value as typeof s.model })}>
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.name} - {m.blurb}</option>)}
        </select>
      </label>}
      <label className="field">
        <span>Thinking</span>
        <select value={s.thinking} onChange={(e) => s.set({ thinking: e.target.value as Thinking })}>
          <option value="MINIMAL">Minimal - fastest</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium - balanced</option>
          <option value="HIGH">High - best musical decisions, slower</option>
        </select>
      </label>
      <label className="field">
        <span>Custom instructions</span>
        <textarea rows={5} maxLength={MAX_CUSTOM_INSTRUCTIONS} value={s.customInstructions} onChange={(e) => s.set({ customInstructions: e.target.value })} placeholder="My usual style is warm, sparse neo-soul. Keep drums human. Explain your edits briefly." aria-label="Custom instructions" />
        <small>Applies to every Agent, Ask and Ctrl+K chat. {user ? 'Synced to your account.' : 'Saved on this device.'} {s.customInstructions.length}/{MAX_CUSTOM_INSTRUCTIONS}</small>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={s.autoListen} onChange={(e) => s.set({ autoListen: e.target.checked })} />
        <span>Let the agent listen<small>It bounces audio and sends it to Gemini to audition samples and check the mix.</small></span>
      </label>
      <label className="field">
        <span>AI listening quality</span>
        <select value={s.listeningQuality} onChange={(e) => s.set({ listeningQuality: e.target.value as typeof s.listeningQuality })}>
          <option value="full">Full quality · 44.1 kHz</option>
          <option value="balanced">Balanced · 22.05 kHz</option>
          <option value="compact">Compact · 16 kHz</option>
        </select>
        <small>Full quality preserves the editor's mix. Lower rates reduce upload size. Each review lets you play the exact audio sent.</small>
      </label>
      <label className="field">
        <span>AI listening channels</span>
        <select value={s.listeningChannels} onChange={(e) => s.set({ listeningChannels: e.target.value as typeof s.listeningChannels })}>
          <option value="stereo">Stereo · preserve width and panning</option>
          <option value="mono">Mono · smaller upload</option>
        </select>
        <small>Applies to the next mix review, sample audition or reference track.</small>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={s.micNoiseSuppression} onChange={(e) => s.set({ micNoiseSuppression: e.target.checked })} />
        <span>Mic noise suppression<small>Cleans up background noise in voice messages. Turn it off to hum or sing a tune: suppression can mute or warble held notes.</small></span>
      </label>
      {firebaseConfigured && (
        <div className="field">
          <span>Account</span>
          {user ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0, overflowWrap: 'anywhere' }}><Cloud size={14} style={{ flex: 'none' }} /> {user.email ?? user.name}</span>
              <button className="btn" onClick={() => void syncNow().then(() => toast('Synced'))}>Sync now</button>
              <button className="btn" onClick={() => void signOut()}><LogOut size={14} /> Sign out</button>
              <button className="btn danger" onClick={() => {if(confirm('Permanently delete your Vibe account, cloud projects, samples, library, and settings? Local project copies stay on this device. This cannot be undone.')) void deleteAccount().then(()=>toast('Account deleted')).catch(e=>toast(e.message,'error'));}}>Delete account</button>
            </div>
          ) : (
            <>
              <button className="btn solid" onClick={() => signIn().catch((e) => toast(e.message, 'error'))}>Sign in to sync</button>
              <small>Syncs projects, your library, API key, custom instructions, AI settings, theme and keyboard shortcuts across devices. Interface size and output latency stay per device.</small>
            </>
          )}
        </div>
      )}
      <NativeHapticsControl />
    </>
  );
}

const flowLabel = (speed: number) => `${Math.round(flowSeconds(speed))} s`;

function AppearanceSettings() {
  const t = useTheme();
  return (
    <>
      <div className="field">
        <span>Theme</span>
        <div className="theme-grid">
          {(Object.keys(THEMES) as ThemeId[]).map((id) => {
            const v = { '--bg': '#050505', '--panel': '#0b0b0c', '--raised': '#1a1a1d', '--text': '#ececee', ...THEMES[id].vars } as Record<string, string>;
            return (
              <button key={id} className={`theme-card ${t.theme === id ? 'on' : ''}`} onClick={() => t.set({ theme: id })} aria-pressed={t.theme === id}>
                <span className="theme-swatch" style={{ background: v['--bg'] }}>
                  <i style={{ background: v['--panel'] }} />
                  <i style={{ background: v['--raised'] }} />
                  <i style={{ background: accentFill(t.accent) }} />
                </span>
                {THEMES[id].name}
              </button>
            );
          })}
        </div>
      </div>
      <div className="field">
        <span>Accent</span>
        <small>The agent's ink: AI changes, selection, and primary buttons. Pick one, or build your own gradient.</small>
        <AccentPicker />
      </div>
      <div className="field">
        <span>Color flow</span>
        <small>How fast the accent's gradients and glows drift. All the way left holds them still.</small>
        <div className="flow-row">
          <input type="range" min={0} max={1} step={0.01} value={t.flow} style={rangeFill(t.flow, 0, 1)} onChange={(e) => t.set({ flow: Number(e.target.value) })} aria-label="Color flow speed" aria-valuetext={t.flow > 0 ? `One pass every ${flowLabel(t.flow)}` : 'Off'} />
          <span>{t.flow > 0 ? flowLabel(t.flow) : 'Off'}</span>
        </div>
      </div>
      <label className="field">
        <span>Interface size</span>
        <select value={t.scale} onChange={(e) => t.set({ scale: Number(e.target.value) })}>
          {[0.85, 0.9, 1, 1.1, 1.25].map((v) => <option key={v} value={v}>{Math.round(v * 100)}%</option>)}
        </select>
      </label>
    </>
  );
}

function KeyboardSettings() {
  const { overrides, setBinding, reset } = useKeymap();
  const [recording, setRecording] = useState<ActionId | null>(null);
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setRecording(null); return; }
      const combo = comboFromEvent(e);
      if (!combo) return;
      // Take the combo away from any other action that used it.
      for (const id of Object.keys(ACTIONS) as ActionId[]) {
        if (id !== recording && bindings(id).includes(combo)) setBinding(id, bindings(id).filter((c) => c !== combo));
      }
      setBinding(recording, [combo]);
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, setBinding]);
  const groups = [...new Set(Object.values(ACTIONS).map((a) => a.group))];
  return (
    <>
      <p className="sub" style={{ marginTop: 0 }}>Click a shortcut, then press the new key combination. Esc cancels.</p>
      {groups.map((g) => (
        <div key={g} className="keymap-group">
          <h4>{g}</h4>
          {(Object.keys(ACTIONS) as ActionId[]).filter((id) => ACTIONS[id].group === g).map((id) => {
            const custom = !!overrides[id];
            return (
              <div key={id} className="keymap-row">
                <span>{ACTIONS[id].label}</span>
                <button className={`key-capture ${recording === id ? 'recording' : ''}`} onClick={() => setRecording(id)} title="Click, then press keys">
                  {recording === id ? 'Press keys…' : bindings(id).length ? bindings(id).map((k) => <kbd key={k}>{k}</kbd>) : <i>Unassigned</i>}
                </button>
                <button className="btn icon" disabled={!custom} onClick={() => reset(id)} title="Restore default" aria-label="Restore default"><RotateCcw size={13} /></button>
              </div>
            );
          })}
        </div>
      ))}
      <div className="modal-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn" onClick={() => reset()}>Reset all shortcuts</button>
      </div>
    </>
  );
}

function PlaybackSettings() {
  const s = useSettings();
  const daw = useDaw();
  return (
    <>
      <div className="field">
        <span>Playback buffer</span>
        <div className="radio-cards">
          <button className={`radio-card ${s.latency === 'stable' ? 'on' : ''}`} onClick={() => s.set({ latency: 'stable' })}>
            <b>Stable</b>
            <span>Larger buffer. No crackles on heavy projects. Recommended.</span>
          </button>
          <button className={`radio-card ${s.latency === 'low' ? 'on' : ''}`} onClick={() => s.set({ latency: 'low' })}>
            <b>Low latency</b>
            <span>Snappier note previews. May crackle on busy songs.</span>
          </button>
        </div>
        <small>Takes effect after you reload the page.</small>
      </div>
      <label className="field">
        <span>Default snap for clips</span>
        <select value={daw.snap} onChange={(e) => daw.setSnap(Number(e.target.value))}>
          <option value={0}>Bar</option><option value={1}>1/4</option><option value={0.5}>1/8</option><option value={0.25}>1/16</option><option value={-1}>Off</option>
        </select>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={daw.followPlayhead} onChange={(e) => daw.setFollow(e.target.checked)} />
        <span>Follow the playhead<small>Scroll the timeline to keep the playhead in view while playing.</small></span>
      </label>
    </>
  );
}

export function ProjectsModal({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const projects = usePersist((s) => s.projects);
  const current = useDaw((s) => s.project.id);
  useEffect(() => { void usePersist.getState().refresh(); }, []);
  const open = async (id: string) => {
    try { await openProject(id); onClose(); } catch (e) { toast((e as Error).message, 'error'); }
  };
  return (
    <Modal className="projects-overlay" title="Projects" sub="Saved on this device, and in the cloud when you're signed in." onClose={onClose}>
      <div className="project-list">
        {projects.map((p) => (
          <div key={p.id} className={`project-item ${p.id === current ? 'current' : ''}`}>
            <button style={{ flex: 1, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => void open(p.id)}>
              <b>{p.name}</b>
              {p.where !== 'local' && <Cloud size={12} color="var(--faint)" />}
              <span className="when">{relativeTime(p.updatedAt)}</span>
            </button>
            <button className="btn icon danger" aria-label={`Delete ${p.name}`} onClick={() => { if (confirm(`Delete “${p.name}”? This can't be undone.`)) void deleteProject(p.id); }}><Trash size={13} /></button>
          </div>
        ))}
        {!projects.length && <div className="dock-empty">No saved projects yet.</div>}
      </div>
      <div className="modal-actions">
        <input ref={fileRef} type="file" accept=".vibe,.mid,.midi,application/json,audio/midi" hidden onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setImporting(true);
          void (/\.midi?$/i.test(file.name) ? importMidiFile(file).then((result) => { toast(`Imported ${result.tracks} MIDI tracks`); if (result.warnings.length) toast(result.warnings.join(' ')); }) : file.text().then(importProjectFile).then(() => toast('Project imported'))).then(() => onClose()).catch((e) => toast(`Import failed: ${(e as Error).message}`, 'error')).finally(() => setImporting(false));
        }} />
        <button className="btn" disabled={importing} onClick={() => fileRef.current?.click()}>{importing ? 'Importing…' : 'Import .vibe / MIDI'}</button>
        <button className="btn" onClick={() => openSavePreset({ kind: 'template', name: useDaw.getState().project.name })}>Save as template</button>
        <button className="btn" onClick={() => void duplicateProject().then(onClose)}><Copy size={14} /> Duplicate current</button>
        <button className="btn primary" onClick={() => void newProject().then(onClose)}><Plus size={14} /> New project</button>
      </div>
    </Modal>
  );
}
