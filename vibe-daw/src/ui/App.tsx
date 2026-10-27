import { useEffect, useState } from 'react';
import { AnnotationDialog } from './components/Annotations';
import { ChatContextMenu } from './components/ChatContextMenu';
import { SavePresetDialog } from './components/SavePreset';
import { CustomEffectEditor } from './components/CustomEffectEditor';
import { TopBar } from './components/TopBar';
import { Browser } from './components/Browser';
import { Arrangement } from './components/Arrangement';
import { Dock } from './components/Dock';
import { AgentPanel } from './components/AgentPanel';
import { InlineAI, openInlineAI } from './components/InlineAI';
import { SettingsModal, ProjectsModal } from './components/Modals';
import { toast, useToasts } from './toast';
import { useDaw, useTransport } from '../state/store';
import { togglePlay, stop } from '../engine/api';
import { isTypingTarget, matchesMedia, NARROW, useMediaQuery } from './hooks';
import { Tooltips } from './Tooltips';
import { HelpModal } from './components/HelpModal';
import { copySelectedClips, deleteSelectedClips, duplicateSelectedClips, newClipOnSelectedTrack, pasteClips, splitAtPlayhead } from './actions';
import { matches } from '../state/keymap';
import { IconDefs } from './icons';
import { ConsentDialog } from '../legal/ConsentDialog';

function Toasts() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div className="toast-wrap" role="status" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
    </div>
  );
}

export function App() {
  const [settings, setSettings] = useState(false);
  const [projects, setProjects] = useState(false);
  const [help, setHelp] = useState(false);
  // On narrow screens the side panels are drawers over the timeline, so they start closed.
  const narrow = useMediaQuery(NARROW);
  const [browserOpen, setBrowserOpen] = useState(() => !matchesMedia(NARROW));
  // A request handed over from Gesture Synth (gesto:pedido, read by AgentPanel) opens the agent even on phones.
  const [agentOpen, setAgentOpen] = useState(() => !matchesMedia(NARROW) || hasGestoRequest());
  const [focusAgent, setFocusAgent] = useState(0);

  // Only one drawer at a time; on wide screens both columns can stay open.
  useEffect(() => { if (narrow && browserOpen) setAgentOpen(false); }, [narrow, browserOpen]);
  useEffect(() => { if (narrow && agentOpen) setBrowserOpen(false); }, [narrow, agentOpen]);

  useEffect(() => {
    const open = () => { setAgentOpen(true); setFocusAgent((n) => n + 1); };
    window.addEventListener('vibe:open-agent', open);
    return () => window.removeEventListener('vibe:open-agent', open);
  }, []);

  useEffect(() => {
    // The agent asks for a key the first time someone tries it, not on page load.
    const open = () => setSettings(true);
    window.addEventListener('vibe:open-settings', open);
    return () => window.removeEventListener('vibe:open-settings', open);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const run = (fn: () => void) => { e.preventDefault(); fn(); };
      // These work even while typing in a text box.
      if (matches(e, 'inlineAI')) return run(() => openInlineAI());
      if (matches(e, 'focusAgent')) return run(() => { setAgentOpen(true); setFocusAgent((n) => n + 1); });
      if (isTypingTarget(e.target)) return;
      const daw = useDaw.getState();
      if (matches(e, 'undo')) return run(() => daw.undo());
      if (matches(e, 'redo')) return run(() => daw.redo());
      if (matches(e, 'playPause')) return run(() => void togglePlay().catch((err) => toast(`Playback failed: ${(err as Error).message}`, 'error')));
      if (matches(e, 'stopRewind')) return run(() => stop(true));
      if (matches(e, 'toggleLoop')) return run(() => daw.update('Toggle loop', (d) => { d.loop.enabled = !d.loop.enabled; }));
      if (matches(e, 'toggleMetronome')) return run(() => useTransport.getState().setMetronome(!useTransport.getState().metronome));
      if (matches(e, 'delete') && daw.selection.clipIds.length) return run(deleteSelectedClips);
      if (matches(e, 'duplicate')) return run(duplicateSelectedClips);
      if (matches(e, 'copy')) return run(() => copySelectedClips());
      if (matches(e, 'cut')) return run(() => copySelectedClips(true));
      if (matches(e, 'paste')) return run(pasteClips);
      if (matches(e, 'split')) return run(splitAtPlayhead);
      if (matches(e, 'newClip')) return run(() => void newClipOnSelectedTrack());
      if (matches(e, 'help')) return run(() => setHelp(true));
      if (matches(e, 'toggleBrowser')) return run(() => setBrowserOpen((v) => !v));
      if (matches(e, 'toggleAgent')) return run(() => setAgentOpen((v) => !v));
      if (matches(e, 'zoomIn')) return run(() => daw.setZoom(daw.zoom * 1.25));
      if (matches(e, 'zoomOut')) return run(() => daw.setZoom(daw.zoom / 1.25));
      if (e.key === 'Escape') {
        daw.select({ clipIds: [] });
        if (matchesMedia(NARROW)) { setBrowserOpen(false); setAgentOpen(false); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app">
      <TopBar
        onOpenSettings={() => setSettings(true)}
        onOpenProjects={() => setProjects(true)}
        onOpenHelp={() => setHelp(true)}
        browserOpen={browserOpen}
        agentOpen={agentOpen}
        toggleBrowser={() => setBrowserOpen((v) => !v)}
        toggleAgent={() => setAgentOpen((v) => !v)}
      />
      <Browser open={browserOpen} onClose={() => setBrowserOpen(false)} />
      <main className="main">
        <Arrangement />
        <Dock />
      </main>
      <AgentPanel open={agentOpen} focusSignal={focusAgent} onClose={() => setAgentOpen(false)} />
      {narrow && (browserOpen || agentOpen) && (
        <div className="drawer-backdrop" onPointerDown={() => { setBrowserOpen(false); setAgentOpen(false); }} aria-hidden />
      )}
      <InlineAI />
      {settings && <SettingsModal onClose={() => setSettings(false)} />}
      {projects && <ProjectsModal onClose={() => setProjects(false)} />}
      {help && <HelpModal onClose={() => setHelp(false)} />}
      <SavePresetDialog />
      <CustomEffectEditor />
      <AnnotationDialog />
      <ChatContextMenu />
      <Tooltips />
      <Toasts />
      <IconDefs />
      <ConsentDialog />
    </div>
  );
}

function hasGestoRequest(): boolean {
  try { return !!localStorage.getItem('gesto:pedido'); } catch { return false; }
}
