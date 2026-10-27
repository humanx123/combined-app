/**
 * Vibe's App Store listing: order, headlines, and how each screen is reached.
 * The engine (generate.cjs, poster.cjs) is shared with Lacuna and MTW; only
 * this file is Vibe's own.
 *
 * Every shot opens the studio and builds the "Late night drive" demo session
 * through the Producer's own tools (scripts/lib/demo-session.mjs, shared with
 * the landing captures), so each screen is the live app with real clips, real
 * mixer state and a real pending agent run. Panels are opened the way a person
 * opens them (the Producer toggle, Ctrl+K); editors through the studio store
 * the app exposes on window.__vibe, as the landing captures do.
 *
 * `popout` marks the element the poster lifts toward the viewer; shots tag it
 * with `data-shot-pop` in `prepare`. `place` positions one image's phone (see
 * poster.cjs): x, y, scale, tilt, lean, layer, popWidth, popOrigin.
 */
const path = require('path');
const { pathToFileURL } = require('url');

const demoSession = () => import(pathToFileURL(path.join(__dirname, '..', 'lib', 'demo-session.mjs')).href);

/** Open the studio, build the demo session, and fit the song to the timeline. */
async function openStudio(page) {
  await page.waitForFunction(() => Boolean(window.__vibe), null, { timeout: 60000 });
  const { buildSession } = await demoSession();
  const ids = await buildSession(page);
  // The sound browser is for finding sounds; these shots are about the session.
  await page.evaluate(() => {
    const s = window.__vibe.useDaw.getState();
    s.select({ trackId: null, clipIds: [] });
    s.openEditor(null);
  });
  const browserClose = page.getByRole('button', { name: 'Close browser' });
  if (await browserClose.isVisible()) await browserClose.click();
  // Fit all 20 bars to the arrangement width, as the landing captures do.
  await page.evaluate(() => {
    const arrange = document.querySelector('[aria-label="Arrangement"]').getBoundingClientRect();
    const header = parseFloat(getComputedStyle(document.querySelector('.arrange')).getPropertyValue('--header-w')) || 0;
    window.__vibe.useDaw.getState().setZoom((arrange.width - header - 12) / 80.5);
  });
  return ids;
}

/** Give the dock room by dragging its handle up, like a user would. */
async function growDock(page, share) {
  const handle = await page.locator('.dock-resize').first().boundingBox();
  if (!handle) return;
  const viewport = page.viewportSize();
  const x = handle.x + handle.width / 2;
  await page.mouse.move(x, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, viewport.height * (1 - share), { steps: 8 });
  await page.mouse.up();
}

const openClip = (page, id) => page.evaluate((clip) => {
  const s = window.__vibe.useDaw.getState();
  s.select({ trackId: null, clipIds: [clip] });
  s.openEditor(clip);
}, id);

/**
 * On a phone, fold the editor dock away (its own button) so the timeline gets
 * the screen. An iPad has room for both, so it shows the mixer there instead
 * of leaving half the screen empty under a short song.
 */
async function collapseDock(page, tablet) {
  if (tablet) {
    await page.evaluate(() => window.__vibe.useDaw.getState().setBottom('mixer'));
    await page.locator('.dock .strip').nth(3).waitFor();
    return;
  }
  const button = page.getByRole('button', { name: 'Collapse dock' });
  if (await button.isVisible()) await button.click();
}

const tag = (page, selector, { parent = false } = {}) => page.evaluate(({ selector, parent }) => {
  const el = Array.from(document.querySelectorAll(selector)).find((node) => node.checkVisibility());
  const target = parent ? el?.parentElement : el;
  if (!target) throw new Error(`Nothing to pop out at ${selector}`);
  target.setAttribute('data-shot-pop', '');
}, { selector, parent });

const shots = [
  // Identity: the brand, as the landing page opens: the wordmark and its line.
  {
    name: 'brand',
    brand: {
      wordmark: { svg: path.join(__dirname, '..', '..', 'public', 'brand', 'wordmark.svg') },
      width: [0.94, 0.74],
      tagline: ['Make music.', '*Make it yours.*'],
      taglineFont: { family: 'Instrument Sans', weight: 700, size: 0.16 },
    },
  },
  // Identity: a whole song in a real DAW, arranged in sections with lyrics.
  {
    name: 'arrangement', url: '/studio',
    prepare: async (page, { tablet }) => {
      await openStudio(page);
      await collapseDock(page, tablet);
    },
    ready: () => document.querySelectorAll('[aria-label="Arrangement"] [class*="clip"]').length >= 6,
    // No pop-out: the whole screen is the point, so the phone carries it.
    place: { layer: 6, lean: 0.6 },
    storyBeat: 'A full studio: tracks, sections, clips and lyrics',
    poster: 'side', title: ['A full music studio', '*on your iPhone*'],
    titleTablet: ['A full music studio', '*on your iPad*'],
  },
  // Identity: the Producer. Asked for a flute hook, it wrote one, listened
  // back, and left the change for you to keep or undo.
  {
    name: 'producer', url: '/studio',
    prepare: async (page) => {
      await openStudio(page);
      const panel = page.locator('.agent');
      if (!(await panel.isVisible())) await page.locator('button[title^="Show or hide the Producer panel"]').click();
      await page.locator('.agent .msg-ai').last().waitFor({ state: 'visible' });
      await page.locator('.agent .msg-ai').last().evaluate((el) => el.scrollIntoView({ behavior: 'instant', block: 'center' }));
      await tag(page, '.agent .msg-ai');
    },
    ready: () => Boolean(document.querySelector('.agent .changes.pending')?.checkVisibility() || document.querySelector('.agent .msg-ai')?.checkVisibility()),
    popout: { selector: '[data-shot-pop]' },
    place: { layer: 5, lean: 0.6, x: -0.03 },
    storyBeat: 'Describe it, and the Producer builds it with real instruments',
    poster: 'center', title: ['Describe a song,', '*the AI builds it*'],
  },
  // Identity: every note is editable. The flute hook the Producer wrote, open
  // in the piano roll.
  {
    name: 'piano-roll', url: '/studio',
    prepare: async (page, { tablet }) => {
      const ids = await openStudio(page);
      await openClip(page, ids.melodyClip);
      await page.locator('.dock .roll-body .note').first().waitFor();
      await growDock(page, tablet ? 0.55 : 0.62);
      // Scroll the roll to its notes, from just above the highest one.
      await page.evaluate(() => {
        const body = document.querySelector('.dock .roll-body');
        const notes = Array.from(body.querySelectorAll('.note'));
        const top = Math.min(...notes.map((n) => n.offsetTop));
        body.scrollTop = Math.max(0, top - 40);
        body.scrollLeft = 0;
      });
      await tag(page, '.dock .roll-body');
    },
    ready: () => Array.from(document.querySelectorAll('.dock .roll-body .note')).filter((n) => {
      const body = document.querySelector('.dock .roll-body').getBoundingClientRect();
      const r = n.getBoundingClientRect();
      return r.top >= body.top && r.bottom <= body.bottom && r.left >= body.left && r.right <= body.right;
    }).length >= 4,
    popout: { selector: '[data-shot-pop]' },
    place: { layer: 4, lean: 0.6 },
    storyBeat: 'Every note the Producer writes is yours to edit in the piano roll',
    poster: 'side', title: ['Edit every note', '*the AI writes*'],
  },
  // Identity: the beat, one step at a time.
  {
    name: 'drums', url: '/studio',
    prepare: async (page, { tablet }) => {
      const ids = await openStudio(page);
      await openClip(page, ids.hookDrums);
      await page.locator('.dock .drum-row').nth(4).waitFor();
      await growDock(page, tablet ? 0.45 : 0.5);
      await tag(page, '.dock .drum-row', { parent: true });
    },
    ready: () => document.querySelectorAll('.dock .drum-row').length >= 5,
    popout: { selector: '[data-shot-pop]' },
    place: { layer: 3, lean: 0.6, x: 0.02 },
    storyBeat: 'Program drums on a step sequencer',
    poster: 'side', title: ['Program beats', '*step by step*'],
  },
  // Identity: the mix. Every track's strip, its effects and its level.
  {
    name: 'mixer', url: '/studio',
    prepare: async (page, { tablet }) => {
      await openStudio(page);
      await page.getByRole('tab', { name: 'Mixer' }).or(page.getByRole('button', { name: 'Mixer', exact: true })).first().click();
      await page.locator('.dock .strip').nth(3).waitFor();
      await growDock(page, tablet ? 0.4 : 0.45);
      await tag(page, '.dock .mixer');
    },
    ready: () => document.querySelectorAll('.dock .strip').length >= 4,
    popout: { selector: '[data-shot-pop]' },
    place: { layer: 2, lean: 0.6 },
    storyBeat: 'Mix with real instruments and effects',
    poster: 'side', title: ['Mix every track', '*with real effects*'],
  },
  // Identity: inline edits. Select a phrase, press Ctrl+K, ask for a change.
  {
    name: 'inline-edit', url: '/studio',
    prepare: async (page, { tablet }) => {
      const ids = await openStudio(page);
      await collapseDock(page, tablet);
      await page.evaluate(({ bass, pad }) => {
        const s = window.__vibe.useDaw.getState();
        s.select({ trackId: bass, clipIds: [], range: { start: 32, end: 48, trackIds: [bass, pad] } });
      }, ids);
      await page.keyboard.press('Control+k');
      const dialog = page.getByRole('dialog', { name: 'Edit with AI' });
      await dialog.waitFor();
      await dialog.locator('input').fill('Walk the bass up into the hook');
      await tag(page, '[role="dialog"]');
    },
    ready: () => Boolean(document.querySelector('[role="dialog"] input')?.value),
    popout: { selector: '[data-shot-pop]' },
    place: { layer: 1, lean: 0.6 },
    storyBeat: 'Select any phrase and ask for exactly the change you want',
    poster: 'center', title: ['Select a part,', '*ask for a change*'],
  },
];

module.exports = {
  app: 'Vibe',
  baseUrl: 'http://127.0.0.1:5173',
  devCommand: 'npm run dev',
  colorScheme: 'dark',
  // A DAW needs its room: the phone lays out at ~350pt, the iPad at a real
  // iPad width so it gets the tablet studio.
  captureZoom: { phone: 1.25, tablet: 1.3 },
  loadingSelectors: ['.spinner', '[aria-busy="true"]'],
  brand: {
    // The studio's near-black panels and the wordmark's violet-pink-amber gradient.
    screenBg: '#050505',
    ground: ['#120d1c', '#07060a', '#030303'],
    ink: '#ff8fcf',
    glow: '255, 143, 207',
    cool: '182, 156, 255',
    text: '#ffffff',
    statusInk: '#ffffff',
    motif: 'ribbon',
    motifColors: ['#b69cff', '#d496ef', '#ff8fcf', '#ffa28b', '#ffb547'],
    layout: { phoneTuck: -0.08, clearDevice: true, deviceScale: [0.94, 1.06], sideShift: [0.025, 0.03] },
    // The wordmark's own violet, pink and amber, across every accent word.
    inkGradient: 'linear-gradient(90deg, #b69cff 0%, #ff8fcf 52%, #ffb547 100%)',
    font: { file: path.join(__dirname, 'fonts', 'InstrumentSans-normal.woff2'), italicFile: path.join(__dirname, 'fonts', 'InstrumentSans-italic.woff2'),
      family: 'Instrument Sans', weight: 700,
      uppercase: false, lineHeight: 1.0, letterSpacing: '-0.035em' },
    wordmarkHtml: '<b>Vibe</b>',
  },
  // Header and search result images lead with what the app does: the
  // wordmark over a plain headline, beside a big fan of phones whose
  // highlights (the AI's work, the notes it wrote) lift off their screens.
  creativeCopy: {
    wordmark: { svg: path.join(__dirname, '..', '..', 'public', 'brand', 'wordmark.svg'), width: 0.55 },
    headline: ['Make music.', '*Make it yours.*'],
  },
  creativeStyle: { fan: true, pops: true, big: true },
  creative: {
    'header-21x9': { phones: ['drums', 'producer', 'piano-roll'] },
    'search-3x2': { phones: ['producer', 'piano-roll'] },
    'universal-16x9': { phones: ['producer', 'piano-roll'] },
  },
  shots,
};
