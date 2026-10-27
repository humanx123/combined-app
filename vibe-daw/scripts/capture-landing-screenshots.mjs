// Captures the real studio UI for the landing page (public/screenshots).
// Run `npm run dev` first, then `npm run screenshots`. The demo session is built
// through the same agent tools the Producer uses, so the studio is the live app. Only
// the Producer chat is seeded (no LLM call): its tool rows are the real tool results.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { buildSession } from './lib/demo-session.mjs';

const BASE = process.env.VIBE_URL ?? 'http://127.0.0.1:5173';
const OUT = fileURLToPath(new URL('../public/screenshots/', import.meta.url));
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

const browser = await chromium.launch(executablePath ? { executablePath } : {});

async function openStudio() {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.goto(`${BASE}/studio`);
  await page.waitForFunction(() => !!window.__vibe, null, { timeout: 60_000 });
  const ids = await buildSession(page);
  await page.keyboard.press('Control+b'); // sound browser off: the crops are about the session
  return { page, ids };
}

// Re-encode in the browser so the script needs nothing beyond Playwright.
async function save(page, name, clip) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(900);
  const pad = clip.pad ?? 0;
  const png = (await page.screenshot({ clip: { x: clip.x - pad, y: clip.y - pad, width: clip.width + pad * 2, height: clip.height + pad * 2 } })).toString('base64');
  const { webp, width, height } = await page.evaluate(async (src) => {
    const img = new Image(); img.src = `data:image/png;base64,${src}`; await img.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height });
    canvas.getContext('2d').drawImage(img, 0, 0);
    return { webp: canvas.toDataURL('image/webp', 0.9).split(',')[1], width: img.width, height: img.height };
  }, png);
  writeFileSync(`${OUT}${name}.webp`, Buffer.from(webp, 'base64'));
  console.log(`${name}.webp ${width}x${height}`);
}

const box = (page, selector) => page.locator(selector).first().boundingBox();
const union = (...boxes) => {
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y));
  return { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
};

{ // The whole studio with the song fitted to the timeline, the Producer panel on its own, then the editors.
  const { page, ids } = await openStudio();
  await page.evaluate(() => { const s = window.__vibe.useDaw.getState(); s.select({ trackId: null, clipIds: [] }); s.openEditor(null); s.setBottom('mixer'); });
  await page.waitForTimeout(300);
  const arrange = await box(page, '[aria-label="Arrangement"]');
  const header = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.arrange')).getPropertyValue('--header-w')));
  await page.evaluate((z) => window.__vibe.useDaw.getState().setZoom(z), (arrange.width - header - 12) / 80.5);
  await page.waitForTimeout(300);
  await save(page, 'studio', { x: 0, y: 0, width: 1440, height: 900 });
  await save(page, 'producer', await box(page, '.agent'));

  // The editors, given room: grow the dock by dragging its handle like a user would.
  const handle = await box(page, '.dock-resize');
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2, handle.y - 170, { steps: 6 }); await page.mouse.up();
  const show = (id) => page.evaluate((id) => { const s = window.__vibe.useDaw.getState(); s.select({ trackId: null, clipIds: [id] }); s.openEditor(id); }, id);
  await show(ids.melodyClip);
  await page.waitForTimeout(300);
  const tools = await box(page, '.dock .roll-tools');
  const hint = await box(page, '.dock .editor-hint');
  // From just above the highest note down through the velocity lane.
  const top = await page.locator('.dock .roll-body .note').evaluateAll((els) => Math.min(...els.map((el) => el.getBoundingClientRect().top)));
  const y = Math.max(tools.y + tools.height, top - 44);
  await save(page, 'piano-roll', { x: tools.x, y, width: tools.width, height: hint.y - y });
  await show(ids.hookDrums);
  await page.waitForTimeout(300);
  const lanes = await page.locator('.dock .drum-row').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  await save(page, 'drums', { ...union(...lanes), pad: 8 });
  await page.evaluate(() => window.__vibe.useDaw.getState().setBottom('mixer'));
  await page.waitForTimeout(300);
  const strips = await page.evaluate(() => {
    const r = [...document.querySelectorAll('.dock [class*="strip"]')].map((el) => el.getBoundingClientRect());
    const x = Math.min(...r.map((b) => b.left)), y = Math.min(...r.map((b) => b.top));
    return { x, y, width: Math.max(...r.map((b) => b.right)) - x, height: Math.max(...r.map((b) => b.bottom)) - y };
  });
  await save(page, 'mixer', { x: strips.x - 8, y: strips.y - 4, width: strips.width + 16, height: strips.height + 6 });
  await page.close();
}

{ // Shift-drag a phrase across tracks, then Ctrl+K.
  const { page, ids } = await openStudio();
  await page.keyboard.press('Control+j');
  await page.evaluate(({ bass, pad }) => {
    const s = window.__vibe.useDaw.getState();
    s.openEditor(null);
    s.setZoom(16);
    s.select({ trackId: bass, clipIds: [], range: { start: 32, end: 48, trackIds: [bass, pad] } });
  }, ids);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Edit with AI' });
  await dialog.locator('input').fill('Walk the bass up into the hook');
  const regions = await page.locator('.selection-region').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
  const d = await dialog.boundingBox();
  const bottom = Math.max(...regions.map((r) => r.y + r.height));
  await save(page, 'inline-edit', { x: d.x - 1, y: d.y - 1, width: d.width + 2, height: bottom - d.y + 1 });
  await page.close();
}

await browser.close();
