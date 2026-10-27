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
    for (const text of ['Play pads with your hands', 'Camera', 'Keyboard', 'Record live', 'Track', 'Sound', 'Warm Pad', 'Key', 'Left hand', 'Wrist tilt', 'Right hand', 'Always sus4', 'Octave', 'Arpeggio', '1/16', 'Quantize takes', 'Auto bass', 'Metronome', 'How to play']) {
      expect(html, text).toContain(text);
    }
    // Record needs an input first.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Record live/);
  });
});
