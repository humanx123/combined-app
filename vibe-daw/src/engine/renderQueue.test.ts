import { afterEach, expect, it, vi } from 'vitest';
import { withRenderSlot } from './renderQueue';
afterEach(() => vi.unstubAllGlobals());
it('shares the mobile context ceiling between independent export and freeze jobs, including failure cleanup', async () => {
  vi.stubGlobal('navigator', { hardwareConcurrency: 8, userAgent: 'Android Chrome/140 Mobile' });
  const starts: string[] = [];
  let finish!: () => void;
  const freeze = withRenderSlot(() => { starts.push('freeze'); return new Promise<void>((resolve) => { finish = resolve; }); });
  const exportJob = withRenderSlot(async () => { starts.push('export'); throw new Error('failed'); });
  const failure = expect(exportJob).rejects.toThrow('failed');
  const listen = withRenderSlot(async () => { starts.push('listen'); return 'audio'; });
  await Promise.resolve(); expect(starts).toEqual(['freeze']);
  finish(); await freeze; await failure;
  expect(await listen).toBe('audio'); expect(starts).toEqual(['freeze', 'export', 'listen']);
});
