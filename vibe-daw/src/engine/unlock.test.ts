import { afterEach, describe, expect, it, vi } from 'vitest';
import { resumeAudioContext } from './unlock';

afterEach(() => vi.useRealTimers());

describe('audio startup', () => {
  it('resumes synchronously before returning to the gesture handler', async () => {
    const ctx = { state: 'suspended' as AudioContextState, resume: vi.fn(async () => { ctx.state = 'running'; }) };
    const ready = resumeAudioContext(ctx);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    await ready;
  });

  it('does not resume an already running context', async () => {
    const ctx = { state: 'running' as AudioContextState, resume: vi.fn() };
    await resumeAudioContext(ctx);
    expect(ctx.resume).not.toHaveBeenCalled();
  });

  it('times out a browser-blocked resume and permits a later gesture to retry', async () => {
    vi.useFakeTimers();
    const ctx = { state: 'suspended' as AudioContextState, resume: vi.fn(() => new Promise<void>(() => {})) };
    const failed = expect(resumeAudioContext(ctx)).rejects.toThrow('Click Play again');
    await vi.advanceTimersByTimeAsync(5000);
    await failed;
    ctx.resume.mockImplementation(async () => { ctx.state = 'running'; });
    await resumeAudioContext(ctx);
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a resume that resolves without starting audio', async () => {
    await expect(resumeAudioContext({ state: 'suspended', resume: async () => {} })).rejects.toThrow('allow sound');
  });
});
