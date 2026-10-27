import { expect, test, type Page } from '@playwright/test';

async function studio(page: Page) {
  await page.goto('/studio');
  await page.waitForFunction(() => !!(window as any).__vibe);
}

test('landing loads only shared and landing styles and pauses offscreen motion', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (req) => requests.push(req.url()));
  await page.goto('/');
  const wordmark = page.locator('.lp-wordmark-wrap');
  await expect(wordmark).toHaveAttribute('data-lp-motion', 'running');
  expect(requests.some((url) => /src\/styles\/global\.css|studio\.tsx|tone|firebase|genai/.test(url))).toBe(false);
  await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('.landing')!;
    root.style.scrollBehavior = 'auto'; root.scrollTop = root.scrollHeight;
  });
  await expect(wordmark).toHaveAttribute('data-lp-motion', 'paused');
  expect(await wordmark.locator('svg').first().evaluate((el) => (el as SVGSVGElement).animationsPaused())).toBe(true);
  expect(await wordmark.locator('.vibe-letter').first().evaluate((el) => getComputedStyle(el).animationPlayState.split(',').every((s) => s.trim() === 'paused'))).toBe(true);
  await page.evaluate(() => { document.querySelector('.landing')!.scrollTop = 0; });
  await expect(wordmark).toHaveAttribute('data-lp-motion', 'running');
  expect(await wordmark.locator('svg').first().evaluate((el) => (el as SVGSVGElement).animationsPaused())).toBe(false);
});

test('landscape reveals finish before content reaches the middle of the screen', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  for (const viewport of [{ width: 844, height: 390 }, { width: 932, height: 430 }, { width: 667, height: 375 }]) {
    await page.setViewportSize(viewport);
    for (const selector of ['.lp-split.lp-reveal', '.lp-band', '.lp-grid .wide', '.lp-mixer', '.lp-promise']) {
      const section = page.locator(selector).first();
      await section.evaluate((el) => {
        const root = document.querySelector<HTMLElement>('.landing')!;
        root.style.scrollBehavior = 'auto';
        root.scrollTop += el.getBoundingClientRect().top - innerHeight / 2;
      });
      await expect(section).toHaveCSS('opacity', '1');
      expect(await page.locator('.landing').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
  }
  await page.screenshot({ path: `test-results/landscape-reveals-${info.project.name}.png` });
});

test('studio defers audio code until a gesture', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (req) => requests.push(req.url()));
  await page.addInitScript(() => {
    const Native = window.OfflineAudioContext;
    const counts = { active: 0, max: 0, renders: 0 };
    (window as any).__synthContexts = counts;
    window.OfflineAudioContext = class extends Native {
      override async startRendering() {
        counts.renders++; counts.active++;
        counts.max = Math.max(counts.max, counts.active);
        try { return await super.startRendering(); }
        finally { counts.active--; }
      }
    };
  });
  await studio(page);
  expect(requests.some((url) => /node_modules\/.*tone|\/engine\/(engine|graph|customFx)\.ts/.test(url))).toBe(false);
  const rendering = await page.evaluate(async () => {
    const { audioBudget } = await import('/src/engine/budget.ts');
    return { ...(window as any).__synthContexts, budget: audioBudget().workers };
  });
  expect(rendering.renders).toBeGreaterThan(1);
  expect(rendering.active).toBe(0);
  expect(rendering.max).toBeLessThanOrEqual(rendering.budget);
});

test('audio waveforms survive moves without redrawing and update when gain changes', async ({ page }) => {
  await studio(page);
  await page.evaluate(async () => {
    const original = CanvasRenderingContext2D.prototype.fillRect;
    const counts = new WeakMap<HTMLCanvasElement, number>();
    (window as any).__waveDraws = counts;
    CanvasRenderingContext2D.prototype.fillRect = function (...args) {
      counts.set(this.canvas, (counts.get(this.canvas) ?? 0) + 1);
      return original.apply(this, args);
    };
    const { createProject, createTrack, createAudioClip } = await import('/src/model/project.ts');
    const { useDaw } = await import('/src/state/store.ts');
    const project = createProject('Waveform check');
    const track = createTrack(project, 'audio');
    track.clips.push(createAudioClip(project, 'b-kick-punchy', 0, 4)); project.tracks.push(track);
    useDaw.getState().replaceProject(project);
  });
  const canvas = page.locator('.clip > canvas');
  const draws = () => canvas.evaluate((el) => (window as any).__waveDraws.get(el) ?? 0);
  await expect.poll(draws).toBeGreaterThan(0);
  const initial = await draws();
  await page.evaluate(() => (window as any).__vibe.useDaw.getState().update('Move and rename', (p: any) => {
    p.tracks[0].clips[0].start = 2; p.tracks[0].clips[0].name = 'Moved'; p.tracks[0].volumeDb = -8;
  }));
  await expect(page.locator('.clip .cname')).toHaveText('Moved');
  expect(await draws()).toBe(initial);
  await page.evaluate(() => (window as any).__vibe.useDaw.getState().update('Clip gain', (p: any) => { p.tracks[0].clips[0].gainDb = -12; }));
  await expect.poll(draws).toBeGreaterThan(initial);
});

test('playheads preserve seek, clip boundaries and zoom coordinates', async ({ page }) => {
  await studio(page);
  await page.evaluate(async () => {
    const { createProject, createTrack, createMidiClip } = await import('/src/model/project.ts');
    const { useDaw, useTransport } = await import('/src/state/store.ts');
    const project = createProject('Playhead check');
    const track = createTrack(project, 'instrument', { preset: 'sub_bass' });
    const clip = createMidiClip(project, 4, 8, 'Phrase');
    track.clips.push(clip); project.tracks.push(track);
    useDaw.getState().replaceProject(project); useDaw.getState().setZoom(50);
    useDaw.getState().openEditor(clip.id); useTransport.getState().setPosition(6);
  });
  const timelineX = () => page.locator('.playhead').evaluate((el) => {
    const parent = el.closest('.timeline')!;
    const header = parent.querySelector('.track-head')!;
    return (el.getBoundingClientRect().left - parent.getBoundingClientRect().left - header.getBoundingClientRect().width);
  });
  await expect.poll(timelineX).toBeCloseTo(300, 1);
  await expect.poll(() => page.locator('.roll-playhead').evaluate((el) => el.getBoundingClientRect().left - el.parentElement!.getBoundingClientRect().left)).toBeCloseTo(144, 1);
  await page.evaluate(() => (window as any).__vibe.useDaw.getState().setZoom(100));
  await expect.poll(timelineX).toBeCloseTo(600, 1);
  await page.evaluate(async () => { const { useTransport } = await import('/src/state/store.ts'); useTransport.getState().setPosition(13); });
  await expect(page.locator('.roll-playhead')).toBeHidden();
  await page.evaluate(async () => { const { useTransport } = await import('/src/state/store.ts'); useTransport.getState().setPosition(4); });
  await expect(page.locator('.roll-playhead')).toBeVisible();
  await expect.poll(() => page.locator('.roll-playhead').evaluate((el) => el.getBoundingClientRect().left - el.parentElement!.getBoundingClientRect().left)).toBeCloseTo(0, 1);
});
