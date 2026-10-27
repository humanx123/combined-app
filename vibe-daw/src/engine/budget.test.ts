import { describe, expect, it } from 'vitest';
import { audioBudget, renderWorkers } from './budget';

describe('audio device budgets', () => {
  it.each([
    { userAgent: 'Mozilla iPhone AppleWebKit/605.1.15 CriOS/123 Mobile/15E Safari/604.1', hardwareConcurrency: 8 },
    { userAgent: 'Mozilla Macintosh AppleWebKit/605.1.15 Safari/605.1.15', maxTouchPoints: 5, hardwareConcurrency: 8 },
    { userAgent: 'Mozilla Android Chrome/140 Mobile AppleWebKit/537.36', hardwareConcurrency: 8 },
    { userAgent: 'Mozilla Windows Chrome/140 AppleWebKit/537.36', hardwareConcurrency: 8, deviceMemory: 2 },
  ])('bounds memory and native context concurrency on constrained devices: %j', (device) => {
    expect(audioBudget(device).workers).toBe(1);
    expect(audioBudget(device).freezeCacheBytes).toBe(64 * 1024 * 1024);
  });
  it('uses available cores for small desktop jobs and reduces concurrency for large buffers', () => {
    const desktop = { hardwareConcurrency: 8, userAgent: 'Chrome/140 AppleWebKit/537.36', deviceMemory: 16 };
    expect(renderWorkers(8 * 1024 * 1024, desktop)).toBe(4);
    expect(renderWorkers(80 * 1024 * 1024, desktop)).toBe(1);
    expect(renderWorkers(0, {})).toBe(1);
  });
});
