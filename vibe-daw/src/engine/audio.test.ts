import { describe, expect, it, vi } from 'vitest';
vi.mock('../samples/library', () => ({ getLoadedBuffer: vi.fn(), getSampleMeta: vi.fn() }));
import { fadeEnvelope } from './audio';

describe('clip fades', () => {
  it('keeps overlapping long fades inside a short clip', () => {
    const e = fadeEnvelope(1, 4, 4);
    expect(e.attack).toBe(0.5);
    expect(e.release).toBe(0.5);
    expect(e.end).toBe(1);
    expect(e.level).toBe(0);
  });
  it('preserves the fade when seeking into its attack or release', () => {
    expect(fadeEnvelope(10, 2, 2, 1)).toEqual({ level: 0.5, attack: 1, release: 7, end: 9 });
    expect(fadeEnvelope(10, 2, 2, 9)).toEqual({ level: 0.5, attack: 0, release: 0, end: 1 });
  });
});
