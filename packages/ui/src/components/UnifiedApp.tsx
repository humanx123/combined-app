/**
 * Unified application shell.
 *
 * Combines the gesture synthesizer interface and the DAW interface into
 * a single, tabbed application. This is the entry point for the combined
 * Gesture Synth Weld + Vibe DAW platform.
 */

import { useState, Suspense, type FormEvent } from 'react';
import { useCombinedStore } from '@combined-app/engine';
import { UnifiedInput } from '../shared/UnifiedInput';
import { GestureDAWSync } from '../shared/GestureDAWSync';
import './UnifiedApp.css';

/** Tab configuration. */
const TABS = [
  { id: 'gesture', label: 'Gesture', icon: '✋' },
  { id: 'piano', label: 'Piano', icon: '🎹' },
  { id: 'mixer', label: 'Mixer', icon: '🎛️' },
  { id: 'ai', label: 'AI', icon: '🤖' },
] as const;

/** The unified application shell. */
export function UnifiedApp() {
  const currentView = useCombinedStore((state) => state.currentView);
  const gestureMode = useCombinedStore((state) => state.gestureMode);
  const inputMode = useCombinedStore((state) => state.inputMode);
  const [activeTab, setActiveTab] = useState(currentView);

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId as any);
    useCombinedStore.getState().setView(tabId as any);
  };

  return (
    <UnifiedInput>
      <GestureDAWSync />
      <div className="unified-app">
        <header className="unified-app__header">
          <div className="unified-app__brand">
            <span className="unified-app__logo">🎵</span>
            <h1 className="unified-app__title">Combined DAW</h1>
          </div>
          <div className="unified-app__status">
            <span className={`unified-app__badge unified-app__badge--${gestureMode}`}>
              {gestureMode}
            </span>
            <span className="unified-app__badge unified-app__badge--input">
              {inputMode}
            </span>
          </div>
        </header>

        <nav className="unified-app__tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`unified-app__tab ${activeTab === tab.id ? 'unified-app__tab--active' : ''}`}
              onClick={() => handleTabChange(tab.id)}
            >
              <span className="unified-app__tab-icon">{tab.icon}</span>
              <span className="unified-app__tab-label">{tab.label}</span>
            </button>
          ))}
        </nav>

        <main className="unified-app__content">
          <Suspense fallback={<div className="unified-app__loading">Loading…</div>}>
            {activeTab === 'gesture' && <GestureTab />}
            {activeTab === 'piano' && <PianoTab />}
            {activeTab === 'mixer' && <MixerTab />}
            {activeTab === 'ai' && <AiTab />}
          </Suspense>
        </main>
      </div>
    </UnifiedInput>
  );
}

/** Gesture tab. */
function GestureTab() {
  return (
    <div className="unified-app__panel">
      <div className="unified-app__panel-header">
        <h2>✋ Gesture Synth</h2>
        <p>Use your hands to play music. Left hand controls harmony, right hand controls expression.</p>
      </div>
      <div className="unified-app__panel-body">
        <div className="gesture-canvas">
          <p>Camera feed and hand tracking will appear here.</p>
          <p className="gesture-canvas__hint">Switch to Keyboard mode in settings if you don't have a camera.</p>
        </div>
      </div>
    </div>
  );
}

/** Piano tab. */
function PianoTab() {
  return (
    <div className="unified-app__panel">
      <div className="unified-app__panel-header">
        <h2>🎹 Piano Roll</h2>
        <p>Edit notes, arrange clips, and build your track.</p>
      </div>
      <div className="unified-app__panel-body">
        <div className="piano-roll">
          <p>Piano roll editor will appear here.</p>
        </div>
      </div>
    </div>
  );
}

/** Mixer tab. */
function MixerTab() {
  return (
    <div className="unified-app__panel">
      <div className="unified-app__panel-header">
        <h2>🎛️ Mixer</h2>
        <p>Adjust levels, pan, and effects for each track.</p>
      </div>
      <div className="unified-app__panel-body">
        <div className="mixer">
          <p>Mixer interface will appear here.</p>
        </div>
      </div>
    </div>
  );
}

/** AI tab. */
function AiTab() {
  const aiInstructions = useCombinedStore((state) => state.aiInstructions);
  const suggestions = useCombinedStore((state) => state.suggestions);
  const setAiInstructions = useCombinedStore((state) => state.setAiInstructions);
  const [input, setInput] = useState(aiInstructions);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setAiInstructions(input);
  };

  return (
    <div className="unified-app__panel">
      <div className="unified-app__panel-header">
        <h2>🤖 AI Assistant</h2>
        <p>Describe what you want and let the AI help you produce your track.</p>
      </div>
      <div className="unified-app__panel-body">
        <form onSubmit={handleSubmit} className="ai-input">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g., make a simple boom bap drumline"
            className="ai-input__field"
          />
          <button type="submit" className="ai-input__submit">
            Generate
          </button>
        </form>
        <div className="ai-suggestions">
          {suggestions.length === 0 ? (
            <p className="ai-suggestions__empty">No suggestions yet. Try asking the AI for help!</p>
          ) : (
            suggestions.map((suggestion) => (
              <div key={suggestion.id} className="ai-suggestion">
                <span className="ai-suggestion__type">{suggestion.type}</span>
                <span className="ai-suggestion__desc">{suggestion.description}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}