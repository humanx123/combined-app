import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const cache = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => cache.get(k) ?? null, setItem: (k: string, v: string) => cache.set(k, v), removeItem: (k: string) => cache.delete(k) } });
});
vi.mock('../engine/api', () => ({ liveChord: vi.fn(), liveNote: vi.fn(), liveRelease: vi.fn(), play: vi.fn(), currentBeat: () => 0 }));
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { GestoPanel } from '../ui/components/GestoPanel';

describe('Gesto panel', () => {
  it('renders the stage, inputs, record bar and every setting', () => {
    const html = renderToString(createElement(GestoPanel, { hidden: false }));
    for (const text of ['Play pads with your hands', 'Camera', 'Keyboard', 'Record live', 'Track', 'Sound', 'Warm Pad', 'Key', 'Left hand', 'Wrist tilt', 'Right hand', 'Always sus4', 'Octave', 'Arpeggio', '1/16', 'Quantize takes', 'Auto bass', 'Metronome', 'How to play', 'Live band', 'Jam']) {
      expect(html, text).toContain(text);
    }
    // The band's own settings show once it is on.
    expect(html).not.toContain('Groove');
    // Record needs an input first.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Record live/);
  });
});

describe('Gesto panel with the live band on', () => {
  it('shows groove, bass style, bass sound and percussion', async () => {
    // Server rendering reads a store's initial state, so start from saved settings, as a returning player would.
    localStorage.setItem('gesto:estudio', JSON.stringify({ band: true }));
    vi.resetModules();
    const { GestoPanel: Fresh } = await import('../ui/components/GestoPanel');
    const html = renderToString(createElement(Fresh, { hidden: false }));
    for (const text of ['Groove', 'Boom bap', 'Reggaetón (dembow)', 'No drums', 'Follows the kick', 'Walking', 'Bass sound', "Groove&#x27;s own (Electric Bass)", '808', 'Percussion']) {
      expect(html, text).toContain(text);
    }
  });
});
