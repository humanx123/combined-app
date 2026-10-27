import { describe, expect, it } from 'vitest';
import { mergePrefs, readSections, type PrefSection, type StampedPref } from './prefs';
import { sanitizeSettings } from '../state/settings';
import { sanitizeAppearance } from '../state/theme';
import { sanitizeKeymap } from '../state/keymap';

const local = (stamps: Partial<Record<PrefSection, StampedPref>> = {}): Record<PrefSection, StampedPref> => ({
  ai: { data: '{"apiKey":"local"}', updatedAt: 10 },
  appearance: { data: '{"theme":"dark"}', updatedAt: 10 },
  keymap: { data: '{}', updatedAt: 10 },
  ...stamps,
});

describe('mergePrefs', () => {
  it('uploads everything when the account has no preferences yet', () => {
    expect(mergePrefs(local(), undefined)).toEqual({ apply: {}, push: true });
  });

  it('takes newer sections from the cloud and keeps newer local ones, per section', () => {
    const remote = {
      ai: { data: '{"apiKey":"remote"}', updatedAt: 20 },
      appearance: { data: '{"theme":"light"}', updatedAt: 5 },
      keymap: { data: '{}', updatedAt: 10 },
    };
    const { apply, push } = mergePrefs(local(), remote);
    expect(apply).toEqual({ ai: remote.ai });
    expect(push).toBe(true);
  });

  it('does nothing when both sides already agree', () => {
    const l = local();
    expect(mergePrefs(l, { ...l })).toEqual({ apply: {}, push: false });
  });

  it('never uploads on a tie, so builds that sanitize differently cannot ping-pong', () => {
    const remote = { ...local(), ai: { data: '{"connection":"firebase"}', updatedAt: 10 } };
    expect(mergePrefs(local(), remote)).toEqual({ apply: {}, push: false });
  });

  it('adopts the account on a device whose preferences were never stamped', () => {
    const fresh = local({ ai: { data: '{}', updatedAt: 0 }, appearance: { data: '{}', updatedAt: 0 }, keymap: { data: '{"a":1}', updatedAt: 0 } });
    const remote = local({ ai: { data: '{"apiKey":"x"}', updatedAt: 1 }, appearance: { data: '{"theme":"light"}', updatedAt: 1 }, keymap: { data: '{}', updatedAt: 1 } });
    const { apply, push } = mergePrefs(fresh, remote);
    expect(Object.keys(apply).sort()).toEqual(['ai', 'appearance', 'keymap']);
    expect(push).toBe(false);
  });
});

describe('synced preference sanitizing', () => {
  it('keeps the API key and valid settings, drops junk', () => {
    const s = sanitizeSettings({ apiKey: 'AIza123', model: 'nope', thinking: 'HIGH', autoListen: false, listeningChannels: 7 });
    expect(s.apiKey).toBe('AIza123');
    expect(s.model).toBe('gemini-3.8-flash');
    expect(s.thinking).toBe('HIGH');
    expect(s.autoListen).toBe(false);
    expect(s.listeningChannels).toBe('stereo');
    expect(s.micNoiseSuppression).toBe(true);
    expect(sanitizeSettings({ micNoiseSuppression: false }).micNoiseSuppression).toBe(false);
  });

  it('rejects unknown themes and non-color accents', () => {
    expect(sanitizeAppearance({ theme: 'light', accent: '#5cc8ff' })).toEqual({ theme: 'light', accent: '#5cc8ff' });
    expect(sanitizeAppearance({ theme: 'toString', accent: 'red; background: url(x)' })).toEqual({ theme: 'dark', accent: 'vibe' });
    // The gradient is the default, and the old default lilac moves to it.
    expect(sanitizeAppearance({ theme: 'dark', accent: 'vibe' }).accent).toBe('vibe');
    expect(sanitizeAppearance({ theme: 'dark', accent: '#B69CFF' }).accent).toBe('vibe');
  });

  it('moves the old four themes onto Dark and Light', () => {
    for (const old of ['midnight', 'graphite', 'oled']) expect(sanitizeAppearance({ theme: old }).theme).toBe('dark');
    expect(sanitizeAppearance({ theme: 'daylight' }).theme).toBe('light');
  });

  it('keeps only known shortcut actions with string combos', () => {
    expect(sanitizeKeymap({ undo: ['Ctrl+U', 3], bogus: ['X'], redo: 'Ctrl+R' })).toEqual({ undo: ['Ctrl+U'] });
  });

  it('leaves device-only settings out of the synced AI section', () => {
    const ai = JSON.parse(readSections().ai);
    expect(ai).not.toHaveProperty('latency');
    expect(ai).toHaveProperty('apiKey');
  });
});
