#!/usr/bin/env node
/**
 * App Store screenshot pipeline, ported from ChatRPE's
 * scripts/generate-screenshots.js. Run by hand on your own machine against the
 * local dev server; nothing here runs in CI.
 *
 *   1. capture — drives the running app in Chrome (playwright-core) at the
 *      exact App Store sizes and saves raws to screenshots/raw/<device>/,
 *      each with `<shot>.popout.json`, the rect of the element the poster
 *      lifts out of the screen.
 *   2. frame   — renders each raw as a listing image (story.cjs owns the
 *      order, headlines and compositions; poster.cjs the look) into
 *      screenshots/appstore/<App Store Connect slot>/, numbered in listing
 *      order, plus the creative assets into screenshots/appstore/creative/.
 *
 * Usage (see docs/APP_STORE_SCREENSHOTS.md):
 *   node scripts/screenshots/generate.cjs                 # capture + frame everything
 *   node scripts/screenshots/generate.cjs --plan          # print the plan, write nothing
 *   node scripts/screenshots/generate.cjs --frame-only    # re-frame from raws; no server needed
 *   node scripts/screenshots/generate.cjs --device=iphone-6-9 --shot=a,b
 *
 * Env: BASE_URL (defaults to the story's), CHROME_PATH (defaults to installed Chrome).
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');
const story = require('./story.cjs');
const { createPoster } = require('./poster.cjs');
const { statusBarHeight, homeAreaHeight } = require('./status-bar.cjs');

const ROOT = path.join(__dirname, '..', '..');
const RAW_DIR = path.join(ROOT, 'screenshots', 'raw');
const OUT_DIR = path.join(ROOT, 'screenshots', 'appstore');
const LAYER_DIR = path.join(OUT_DIR, 'layers');
const CREATIVE_DIR = path.join(OUT_DIR, 'creative');
const BASE_URL = (process.env.BASE_URL || story.baseUrl).replace(/\/$/, '');
const CHROME_PATH = process.env.CHROME_PATH ||
  { win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }[process.platform] || '/usr/bin/google-chrome';

/**
 * The sizes App Store Connect requires: iPhone 6.9" and 6.3" and iPad 13".
 * Every other display class is filled from these. `captureZoom` (from the story)
 * shrinks the logical viewport and raises the scale factor by the same amount,
 * so the raw lands at the output size while the app lays out narrower and its
 * text stays readable once the screen is scaled into the poster.
 */
const DEVICES = [
  {
    name: 'iphone-6-9',
    uploadDir: 'iPhone 6.9 inch',
    viewport: { width: 440, height: 956, deviceScaleFactor: 3 },
    output: { width: 1320, height: 2868 },
    kind: 'phone',
  },
  {
    // App Store Connect's "6.1" or 6.3"" slot (iPhone 17 / 16 Pro class),
    // required alongside 6.9".
    name: 'iphone-6-3',
    uploadDir: 'iPhone 6.3 inch',
    viewport: { width: 402, height: 874, deviceScaleFactor: 3 },
    output: { width: 1206, height: 2622 },
    kind: 'phone',
  },
  {
    name: 'ipad-13',
    uploadDir: 'iPad 13 inch',
    viewport: { width: 1032, height: 1376, deviceScaleFactor: 2 },
    output: { width: 2064, height: 2752 },
    kind: 'tablet',
  },
];

const SHOTS = story.shots;
// iOS Safari user agents, so the app serves what it serves on an iPhone / iPad.
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const failures = [];

function zoomedViewport(device, shot) {
  const zoom = (story.captureZoom?.[device.kind] ?? 1) * (shot?.captureZoom?.[device.kind] ?? 1);
  const { width, height, deviceScaleFactor } = device.viewport;
  const w = Math.round(width / zoom);
  // The poster draws the iOS status bar and home indicator around the capture,
  // so the app gets the screen between them, as it does on a device, and the
  // capture fills the framed screen flush, with no bars.
  const kind = device.kind === 'phone' ? 'phone' : 'tablet';
  // Top and bottom safe areas (status bar and island; home indicator and
  // corners) stay out of the capture, so nothing the app draws sits under them.
  const inset = statusBarHeight({ w }, kind) + homeAreaHeight({ w }, kind);
  return { viewport: { width: w, height: Math.round(height / zoom) - inset }, deviceScaleFactor: deviceScaleFactor * zoom };
}

/**
 * Nothing may still be loading when the shutter fires: fonts, images, the
 * story's loading indicators, and the DOM itself must all be quiet. Checked
 * twice, once to wait and once as an assertion right before the screenshot.
 */
async function waitForStableRender(page, { quietMs = 700, timeout = 30000 } = {}) {
  await page.waitForFunction(({ loading }) => {
    if (document.readyState !== 'complete') return false;
    if (document.fonts.status !== 'loaded') return false;
    if (Array.from(document.images).some((img) => img.checkVisibility() && !img.complete)) return false;
    return !loading.some((sel) => Array.from(document.querySelectorAll(sel)).some((el) => el.checkVisibility()));
  }, { loading: story.loadingSelectors || [] }, { timeout });
  // The DOM has to sit still for `quietMs` (animations off, so nothing moves on its own).
  await page.evaluate((quiet) => new Promise((resolve) => {
    let timer = setTimeout(done, quiet);
    const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, quiet); });
    function done() { observer.disconnect(); resolve(); }
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  }), quietMs);
}

/**
 * Record where the popped element sits, in CSS px of the capture viewport.
 * It must be on screen (95% at least) or the capture fails, rather than
 * popping out cut off. `chips` are measured here too, one box per text line.
 */
async function capturePopout(page, shot, file) {
  fs.rmSync(file, { force: true });
  if (!shot.popout) return;
  const rect = await page.evaluate(({ within, selector, text }) => {
    const scope = within
      ? Array.from(document.querySelectorAll(within)).filter((el) => el.checkVisibility()).at(-1)
      : document;
    const target = Array.from(scope?.querySelectorAll(selector) || []).find((el) =>
      el.checkVisibility() && (!text || (el.textContent || '').includes(text)));
    if (!target) return { error: 'not found' };
    const box = target.getBoundingClientRect();
    const visible = Math.min(box.bottom, window.innerHeight) - Math.max(box.top, 0);
    const visibleX = Math.min(box.right, window.innerWidth) - Math.max(box.left, 0);
    if (visible < box.height * 0.95 || visibleX < box.width * 0.95) {
      return { error: `only ${Math.round((Math.min(visible / box.height, visibleX / box.width)) * 100)}% on screen` };
    }
    return { x: box.left, y: box.top, width: box.width, height: box.height,
      viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
  }, shot.popout);
  if (rect.error) throw new Error(`Pop-out ${JSON.stringify(shot.popout)}: ${rect.error}`);
  if (shot.chips) {
    rect.chips = await page.evaluate(({ within, selector }) => {
      const scope = within ? Array.from(document.querySelectorAll(within)).filter((el) => el.checkVisibility()).at(-1) : document;
      return Array.from(scope?.querySelectorAll(selector) || []).filter((el) => el.checkVisibility()).map((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const lines = [];
        for (const box of Array.from(range.getClientRects()).filter((b) => b.width > 0)) {
          const line = lines.find((l) => Math.abs(l.y - box.top) < box.height / 2);
          if (!line) { lines.push({ x: box.left, y: box.top, right: box.right, bottom: box.bottom }); continue; }
          Object.assign(line, { x: Math.min(line.x, box.left), y: Math.min(line.y, box.top),
            right: Math.max(line.right, box.right), bottom: Math.max(line.bottom, box.bottom) });
        }
        return lines.map((l) => ({ x: l.x, y: l.y, width: l.right - l.x, height: l.bottom - l.y }));
      });
    }, shot.chips);
    if (!rect.chips.length) throw new Error(`Chips ${JSON.stringify(shot.chips)}: not found`);
  }
  fs.writeFileSync(file, `${JSON.stringify(rect)}\n`);
}

/** True when the first visible match is less than fully on screen. */
const offScreen = (selector) => {
  const el = Array.from(document.querySelectorAll(selector)).find((node) => node.checkVisibility());
  if (!el) return false;
  const box = el.getBoundingClientRect();
  return box.top < 0 || box.bottom > window.innerHeight;
};

async function captureDevice(browser, device, shots) {
  console.log(`  [${device.name}] ${device.output.width}x${device.output.height}`);
  const dir = path.join(RAW_DIR, device.name);
  fs.mkdirSync(dir, { recursive: true });
  for (const shot of shots.filter((s) => !s.brand)) {
    // A fresh context per shot: no state from one shot leaks into the next.
    const context = await browser.newContext({
      ...zoomedViewport(device, shot), isMobile: device.kind === 'phone', hasTouch: true,
      colorScheme: story.colorScheme || 'light', reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'America/New_York',
      userAgent: story.userAgent?.(device) ?? (device.kind === 'phone' ? IPHONE_UA : IPAD_UA),
    });
    const ctx = { device, shot, baseUrl: BASE_URL, tablet: device.kind === 'tablet' };
    try {
      // Dev tooling and the story's own chrome never belong in a listing image,
      // on any page a shot navigates through.
      await context.addInitScript((css) => {
        const add = () => { const el = document.createElement('style'); el.textContent = css; document.documentElement.appendChild(el); };
        if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
      }, `nextjs-portal, [data-nextjs-toast], #vite-error-overlay${(story.hideSelectors || []).map((s) => `, ${s}`).join('')} { display: none !important; }
        *, *::before, *::after { caret-color: transparent !important; }`);
      await story.prepareContext?.(context, ctx);
      const page = await context.newPage();
      page.on('pageerror', (error) => console.warn(`    page error (${shot.name}): ${error.message.split('\n')[0]}`));
      await page.goto(`${BASE_URL}${shot.url}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await story.afterLoad?.(page, ctx);
      if (shot.prepare) await shot.prepare(page, ctx);
      if (shot.ready) await page.waitForFunction(shot.ready, shot.readyArg ?? null, { timeout: 45000 });
      await waitForStableRender(page);
      if (shot.reveal) {
        await page.evaluate((selector) => document.querySelector(selector)?.scrollIntoView({ behavior: 'instant', block: 'center' }), shot.reveal);
        await waitForStableRender(page);
      }
      // A late layout pass (hydration, a lazy figure) can push the pop-out off
      // screen after the story placed it: bring it back to the middle.
      if (shot.popout && !shot.popout.within && await page.evaluate(offScreen, shot.popout.selector)) {
        await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ behavior: 'instant', block: 'center' }), shot.popout.selector);
        await waitForStableRender(page);
      }
      await page.mouse.move(0, 0);
      // Readiness again, as an assertion: a screen that changed since is a failure.
      if (shot.ready && !(await page.evaluate(shot.ready, shot.readyArg ?? null))) throw new Error('screen fell out of its ready state before capture');
      const file = path.join(dir, `${shot.name}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      await capturePopout(page, shot, file.replace(/\.png$/, '.popout.json'));
      console.log(`  [${device.name}] ✓ ${shot.name}`);
    } catch (error) {
      console.error(`  [${device.name}] ✗ ${shot.name}: ${error.message.split('\n')[0]}`);
      failures.push(`capture ${device.name}/${shot.name}`);
    } finally {
      await context.close();
    }
  }
}

/**
 * A brand image may use the brand exactly as its landing page renders it
 * (`brand.capture`: { url, selector, hide? }): the element is shot on a
 * transparent page at phone width, 3x, once for every device.
 */
async function captureBrand(browser, shot) {
  const { url, selector, hide = [] } = shot.brand.capture;
  const context = await browser.newContext({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
    colorScheme: story.colorScheme || 'light', reducedMotion: 'reduce', userAgent: IPHONE_UA });
  try {
    await story.prepareContext?.(context, { brand: true });
    const page = await context.newPage();
    await page.goto(`${BASE_URL}${url}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.addStyleTag({ content: `html, body, body * { background: transparent !important; background-color: transparent !important; }
      nextjs-portal ${hide.map((h) => `, ${h}`).join('')} { visibility: hidden !important; }` });
    await waitForStableRender(page);
    const file = path.join(RAW_DIR, 'brand', `${shot.name}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.locator(selector).first().screenshot({ path: file, omitBackground: true, animations: 'disabled' });
    console.log(`  [brand] ✓ ${shot.name}`);
  } catch (error) {
    console.error(`  [brand] ✗ ${shot.name}: ${error.message.split('\n')[0]}`);
    failures.push(`capture brand/${shot.name}`);
  } finally {
    await context.close();
  }
}

async function captureAll(browser, devices, shots) {
  console.log(`\n=== CAPTURE (${BASE_URL}) ===`);
  try {
    const res = await fetch(BASE_URL);
    if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
  } catch (error) {
    throw new Error(`Dev server not reachable at ${BASE_URL} (${error.message}). Start it with \`${story.devCommand}\` first.`);
  }
  for (const shot of shots.filter((s) => s.brand?.capture)) await captureBrand(browser, shot);
  for (const device of devices) await captureDevice(browser, device, shots);
}

async function frameAll(browser, devices, shots, { creative = true } = {}) {
  console.log('\n=== FRAME ===');
  const poster = createPoster(story.brand);
  const page = await (await browser.newContext({ deviceScaleFactor: 1 })).newPage();
  const jobs = [];
  for (const device of devices) {
    const outDir = path.join(OUT_DIR, device.uploadDir);
    fs.mkdirSync(outDir, { recursive: true });
    // A full run replaces the whole set; a --shot run leaves the others in place.
    if (shots.length === SHOTS.length) {
      for (const file of fs.readdirSync(outDir)) if (/^\d{2}-.*\.png$/.test(file)) fs.rmSync(path.join(outDir, file));
    }
    for (const shot of shots) {
      const index = SHOTS.indexOf(shot);
      if (shot.brand) {
        // The brand image has no capture: wordmark and tagline on the canvas.
        const capture = shot.brand.capture ? path.join(RAW_DIR, 'brand', `${shot.name}.png`) : null;
        if (capture && !fs.existsSync(capture)) {
          console.warn(`  ⚠ Missing brand capture ${path.relative(ROOT, capture)}; skipping`);
          failures.push(`missing brand capture ${shot.name}`);
          continue;
        }
        await poster.renderBrand(page, { device, shot, index, capture, layerDir: path.join(LAYER_DIR, device.name) });
        jobs.push({ device, shot, index });
        continue;
      }
      const rawPath = path.join(RAW_DIR, device.name, `${shot.name}.png`);
      if (!fs.existsSync(rawPath)) {
        console.warn(`  ⚠ Missing raw ${path.relative(ROOT, rawPath)}; skipping`);
        failures.push(`missing raw ${device.name}/${shot.name}`);
        continue;
      }
      const popPath = rawPath.replace(/\.png$/, '.popout.json');
      const job = { device, shot, index, rawPath, layerDir: path.join(LAYER_DIR, device.name),
        outPath: path.join(outDir, `${String(index + 1).padStart(2, '0')}-${shot.name}.png`) };
      try {
        await poster.renderPoster(page, { ...job, popPath: fs.existsSync(popPath) ? popPath : null });
        jobs.push(job);
      } catch (error) {
        console.error(`  ✗ ${device.name}/${shot.name}: ${error.message}`);
        failures.push(`frame ${device.name}/${shot.name}`);
      }
    }
  }
  // Composed once every layer is on disk, so a phone that runs off one image
  // carries on into the next. Neighbours outside a --shot run are recomposed
  // too, so their seams still line up.
  const done = new Set();
  const compose = async (device, shot) => {
    const key = `${device.name}/${shot.name}`;
    if (done.has(key)) return;
    done.add(key);
    const i = SHOTS.indexOf(shot);
    const layerDir = path.join(LAYER_DIR, device.name);
    if (!fs.existsSync(path.join(layerDir, `${shot.name}.bg.png`))) return;
    const outPath = path.join(OUT_DIR, device.uploadDir, `${String(i + 1).padStart(2, '0')}-${shot.name}.png`);
    await poster.composePoster({ layerDir, outPath, device, shot, prev: SHOTS[i - 1] || null, next: SHOTS[i + 1] || null });
    console.log(`  ✓ ${path.relative(ROOT, outPath)}`);
  };
  for (const job of jobs) await compose(job.device, job.shot);
  for (const job of jobs) for (const s of [SHOTS[job.index - 1], SHOTS[job.index + 1]]) if (s) await compose(job.device, s);

  if (creative && story.creative) {
    try {
      // Every creative asset leads with the listing's brand block.
      const brandShot = SHOTS.find((s) => s.brand);
      if (!brandShot) throw new Error('Creative assets need a brand image in the story');
      const brandCapture = brandShot.brand.capture ? path.join(RAW_DIR, 'brand', `${brandShot.name}.png`) : null;
      const written = await poster.renderCreativeAssets(page, {
        rawDir: path.join(RAW_DIR, 'iphone-6-9'), outDir: CREATIVE_DIR, creative: story.creative, brandShot, brandCapture,
        // What the app does, in plain words; the listing's first image carries the brand.
        copy: story.creativeCopy,
        style: story.creativeStyle,
      });
      for (const file of written) console.log(`  ✓ ${path.relative(ROOT, file)}`);
    } catch (error) {
      console.error(`  ✗ creative assets: ${error.message}`);
      failures.push('creative assets');
    }
  }
}

function parseArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, '').split('=');
    opts[key] = value === undefined ? true : value;
  }
  return opts;
}

function select(list, names, label) {
  if (!names) return list;
  const wanted = String(names).split(',');
  const unknown = wanted.filter((name) => !list.some((item) => item.name === name));
  if (unknown.length) throw new Error(`Unknown ${label}: ${unknown.join(', ')} (have: ${list.map((item) => item.name).join(', ')})`);
  return list.filter((item) => wanted.includes(item.name));
}

function validateStory() {
  const names = new Set();
  for (const shot of SHOTS) {
    if (names.has(shot.name)) throw new Error(`Duplicate shot name: ${shot.name}`);
    names.add(shot.name);
    if (shot.brand) {
      if (!shot.brand.capture && (!(shot.brand.wordmark || shot.brand.mark) || !shot.brand.tagline?.length)) throw new Error(`Brand image ${shot.name} needs a wordmark and a tagline, or a capture`);
      continue;
    }
    if (!shot.url) throw new Error(`Shot ${shot.name} has no url`);
    if (!shot.storyBeat?.trim()) throw new Error(`Missing story beat on ${shot.name}`);
    if (!Array.isArray(shot.title) || shot.title.length < 1 || shot.title.length > 3) throw new Error(`Titles must have 1-3 lines on ${shot.name}`);
    for (const line of [...shot.title, ...(shot.titleTablet || [])]) {
      if (line.replace(/\*/g, '').length > 26) throw new Error(`Title line too long on ${shot.name}: "${line}"`);
      if ((line.match(/\*/g) || []).length % 2) throw new Error(`Unpaired accent marker on ${shot.name}: "${line}"`);
    }
    if (!shot.ready) throw new Error(`Shot ${shot.name} needs a ready() check, so it is never captured mid-load`);
  }
  if (SHOTS.length > 10) throw new Error('App Store Connect takes at most ten screenshots');
  for (const [asset, spec] of Object.entries(story.creative || {})) {
    for (const name of spec.phones) if (!names.has(name)) throw new Error(`Creative asset ${asset} names unknown shot ${name}`);
  }
}

function printPlan(devices, shots) {
  console.log(`${story.app}: ${shots.length} shot(s) × ${devices.length} device(s), from ${BASE_URL}\n`);
  for (const device of devices) {
    const { viewport, deviceScaleFactor } = zoomedViewport(device);
    console.log(`  ${device.name.padEnd(12)} ${device.output.width}x${device.output.height}  layout ${viewport.width}x${viewport.height}@${deviceScaleFactor.toFixed(2)}  → screenshots/appstore/${device.uploadDir}/`);
  }
  console.log('');
  for (const shot of shots) {
    const n = String(SHOTS.indexOf(shot) + 1).padStart(2, '0');
    if (shot.brand) {
      console.log(`  ${n} ${shot.name.padEnd(20)} brand   ${shot.brand.capture ? `as rendered at ${shot.brand.capture.url} (${shot.brand.capture.selector})` : shot.brand.tagline.join(' / ').replace(/\*/g, '')}`);
      continue;
    }
    console.log(`  ${n} ${shot.name.padEnd(20)} ${(shot.poster || 'side').padEnd(7)} ${shot.title.join(' / ').replace(/\*/g, '')}`);
    console.log(`     ${shot.url}  — ${shot.storyBeat}`);
  }
}

const HELP = `Usage: node scripts/screenshots/generate.cjs [options]

  --plan             print the plan and exit
  --capture-only     capture raws, skip framing
  --frame-only       re-frame existing raws (no dev server needed)
  --no-creative      skip the header / search creative assets
  --device=<names>   ${DEVICES.map((d) => d.name).join(', ')}
  --shot=<names>     ${SHOTS.map((s) => s.name).join(', ')}
  --headed           show the capture browser

Start the app first: ${story.devCommand}  (BASE_URL=${BASE_URL})`;

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return console.log(HELP);
  validateStory();
  const devices = select(DEVICES, opts.device, 'device');
  const shots = select(SHOTS, opts.shot, 'shot');
  if (opts.plan) return printPlan(devices, shots);
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: !opts.headed });
  try {
    if (!opts['frame-only']) await captureAll(browser, devices, shots);
    if (!opts['capture-only']) await frameAll(browser, devices, shots, { creative: !opts['no-creative'] && devices.some((d) => d.name === 'iphone-6-9') });
  } finally {
    await browser.close();
  }
  if (failures.length) {
    console.error(`\n${failures.length} failure(s):\n  ${failures.join('\n  ')}`);
    process.exitCode = 1;
  } else {
    console.log(`\nDone. Review screenshots/appstore/ before uploading.`);
  }
}

main().catch((error) => { console.error(error.message); process.exit(1); });
