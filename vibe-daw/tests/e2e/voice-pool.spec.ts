import { expect, test } from '@playwright/test';

test('dense synth passages keep sounding through voice stealing without dropped-note warnings', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => { if (message.text().includes('Max polyphony')) warnings.push(message.text()); });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    // @ts-expect-error browser-only module URL
    const { renderDenseVoices } = await import('/tests/e2e/voicePool.fixture.ts');
    return renderDenseVoices();
  });
  expect(warnings).toEqual([]);
  for (const check of result) { expect(check.finite).toBe(true); expect(check.rms).toBeGreaterThan(0.001); }
});
