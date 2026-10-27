import { expect, test } from '@playwright/test';

for (const [name, path] of [
  ['freeze buffers match unfrozen stems', 'freeze'],
  ['exports match live and frozen playback', 'exportParity'],
] as const) {
  test(name, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Native DSP parity is checked once; mobile resource/gesture/export checks run in studio.spec.ts.');
    test.setTimeout(150_000);
    await page.goto(`/tests/browser/${path}.html`);
    await page.locator('#run').click();
    await expect(page.locator('#result')).toContainText('DONE', { timeout: 140_000 });
    const result = await page.locator('#result').innerText();
    console.log(result);
    expect(result).not.toMatch(/FAIL|ERROR/);
    expect(result).toContain('PASS');
  });
}
