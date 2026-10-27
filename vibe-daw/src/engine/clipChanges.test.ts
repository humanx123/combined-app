import { describe, expect, it } from 'vitest';
import { sameAudibleClips } from './clipChanges';
import type { MidiClip } from '../model/types';

const clip = (id: string, muted = false): MidiClip => ({ id, type: 'midi', name: id, start: 0, length: 4, notes: [], muted });

describe('sameAudibleClips', () => {
  it('ignores edits to muted clips', () => {
    const a = clip('a'), rec = clip('rec', true);
    expect(sameAudibleClips([a, rec], [a, { ...rec, length: 8 }])).toBe(true);
    expect(sameAudibleClips([a], [a, clip('new', true)])).toBe(true);
  });
  it('sees any audible change', () => {
    const a = clip('a'), rec = clip('rec', true);
    expect(sameAudibleClips([a, rec], [a, { ...rec, muted: false }])).toBe(false);
    expect(sameAudibleClips([a], [{ ...a, length: 8 }])).toBe(false);
    expect(sameAudibleClips(null, [a])).toBe(false);
  });
});
