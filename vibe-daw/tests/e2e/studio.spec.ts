import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page, kind = 'instrument') {
  await page.goto('/studio');
  await page.waitForFunction(() => !!(window as any).__vibe);
  await page.evaluate(async (kind) => {
    // Browser-native imports exercise the real store and editors without an LLM.
    const { createProject, createTrack, createMidiClip } = await import('/src/model/project.ts');
    const { useDaw } = await import('/src/state/store.ts');
    const p = createProject('Selection check');
    const t = createTrack(p, kind as any, { preset: 'sub_bass' });
    const c = createMidiClip(p, 0, 8, 'Intro phrase');
    c.notes = [0, 1, 2, 3, 4, 5, 6, 7].map((start) => ({ id: `note${start}`, start, pitch: kind === 'drums' ? 36 : 60, duration: 0.25, velocity: 0.7 }));
    t.clips.push(c); p.tracks.push(t);
    useDaw.getState().replaceProject(p);
    useDaw.getState().setZoom(50);
    useDaw.getState().select({ trackId: t.id, clipIds: [c.id] });
    useDaw.getState().openEditor(c.id);
  }, kind);
}

test('landing opens the studio without loading its audio engine', async ({ page }, info) => {
  const requests: string[] = [];
  page.on('request', (req) => requests.push(req.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Make music\.\s*Make it yours\./);
  await expect(page.getByRole('main').getByRole('img', { name: 'Vibe', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect(requests.some((url) => /tone|firebase|studio\.tsx|genai/.test(url))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/landing-${info.project.name}.png`, fullPage: true });
  await page.getByRole('main').getByRole('link', { name: 'Open the studio' }).first().click();
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Arrangement', exact: true })).toBeVisible();
});

test('landing shows one donation QR code at a time', async ({ page }) => {
  await page.goto('/');
  const btc = page.getByRole('button', { name: 'Show Bitcoin QR code' });
  await btc.click();
  await expect(page.getByRole('img', { name: 'QR code for the Bitcoin address' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hide Bitcoin QR code' })).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Show Monero QR code' }).click();
  await expect(page.getByRole('img', { name: 'QR code for the Monero address' })).toBeVisible();
  await expect(page.getByRole('img', { name: /^QR code for/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Hide Monero QR code' }).click();
  await expect(page.getByRole('img', { name: /^QR code for/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('first-run Gemini setup is fully visible and not covered by the timeline', async ({ page }) => {
  await page.goto('/studio');
  await page.waitForFunction(() => !!(window as any).__vibe);
  const card = page.locator('.hero-card');
  await expect(card.getByRole('heading', { name: 'First, connect Gemini.' })).toBeVisible();
  const layout = await card.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const onTop = (child: Element) => { const r = child.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + 8, r.y + r.height / 2)); };
    return {
      fits: el.scrollHeight <= el.clientHeight + 1,
      inView: box.top >= 0 && box.bottom <= innerHeight + 1,
      titleOnTop: onTop(el.querySelector('h1')!),
      inputOnTop: onTop(el.querySelector('input')!),
      // Phones show it centered on screen; desktop centers it in the timeline instead.
      centered: innerWidth > 640 || Math.abs((box.top + box.bottom) / 2 - innerHeight / 2) <= 2,
    };
  });
  expect(layout).toEqual({ fits: true, inView: true, titleOnTop: true, inputOnTop: true, centered: true });
});

test('range drag from inside a clip passes exact notes to Ctrl+K', async ({ page }, info) => {
  await fixture(page);
  const lane = page.locator('.track-row > .lane').first();
  const box = (await lane.boundingBox())!;
  // Range button provides the same gesture without a modifier on touch screens.
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Range', exact: true }).click();
  else await page.keyboard.down('Shift');
  await page.mouse.move(box.x + 50, box.y + 35);
  await page.mouse.down(); await page.mouse.move(box.x + 150, box.y + 35, { steps: 8 }); await page.mouse.up();
  if (info.project.name === 'desktop') await page.keyboard.up('Shift');
  const selection = await page.evaluate(() => (window as any).__vibe.useDaw.getState().selection);
  expect(selection.range).toMatchObject({ start: 1, end: 3 });
  if (info.project.name === 'desktop') await page.keyboard.press('Control+k');
  else await page.getByRole('button', { name: /Edit selection/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit with AI' });
  await expect(dialog).toContainText('2 selected notes');
  await expect(dialog.locator('.suggestion')).toHaveCount(6);
  const before = await dialog.locator('.suggestion').allTextContents();
  await dialog.getByRole('button', { name: 'More ideas' }).click();
  expect(await dialog.locator('.suggestion').allTextContents()).not.toEqual(before);
  await page.screenshot({ path: `test-results/selection-${info.project.name}.png` });
});

test('piano roll selection stores note IDs and preserves them when opening AI', async ({ page }) => {
  await fixture(page);
  await page.locator('.roll-body').focus();
  await page.keyboard.press('Control+a');
  const selection = await page.evaluate(() => (window as any).__vibe.useDaw.getState().selection);
  expect(selection.notes?.[0].noteIds).toHaveLength(8);
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit with AI' })).toContainText('8 selected notes');
});

test('drum grid selects a phrase and offers drum-specific ideas', async ({ page }) => {
  await fixture(page, 'drums');
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const a = (await page.locator('[data-lane="0"][data-step="0"]').boundingBox())!;
  const b = (await page.locator('[data-lane="0"][data-step="8"]').boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Edit with AI', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit with AI' })).toContainText('3 selected notes');
});

test('new offline instruments and parametric EQ render audible finite PCM; WAV worker exports valid audio', async ({ page }) => {
  await fixture(page);
  const result = await page.evaluate(async () => {
    const { createProject, createTrack, createMidiClip } = await import('/src/model/project.ts');
    const { renderProject, exportAudio } = await import('/src/engine/api.ts');
    const { defaultEffectParams } = await import('/src/model/catalog.ts');
    const presets = ['analog_brass', 'fm_bass', 'marimba', 'kalimba', 'chiptune', 'glass_pad'];
    const measurements = [];
    for (const preset of presets) {
      const p = createProject(); const t = createTrack(p, 'instrument', { preset });
      const c = createMidiClip(p, 0, 2); c.notes = [{ id: 'n', pitch: 60, start: 0, duration: 1, velocity: 0.8 }];
      t.effects = [{ id: 'fx', type: 'parametric_eq', enabled: true, params: { ...defaultEffectParams('parametric_eq'), gain2: -4, gain3: 2 } }];
      t.clips.push(c); p.tracks.push(t);
      const pcm = await renderProject(p, { endBeat: 2, tail: 0.5, sampleRate: 22050 });
      const data = pcm.channels[0];
      measurements.push({ preset, finite: data.every(Number.isFinite), peak: Math.max(...data.map(Math.abs)) });
    }
    const project = (window as any).__vibe.useDaw.getState().project;
    let frames = 0; const interval = setInterval(() => frames++, 5);
    const started = performance.now();
    const wav = await exportAudio(project, 'wav24');
    clearInterval(interval);
    const decoded = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await wav.arrayBuffer());
    return { measurements, type: wav.type, seconds: decoded.duration, frames, ms: performance.now() - started };
  });
  for (const measurement of result.measurements) {
    expect(measurement.finite, measurement.preset).toBe(true);
    expect(measurement.peak, measurement.preset).toBeGreaterThan(0.001);
  }
  expect(result.type).toBe('audio/wav'); expect(result.seconds).toBeGreaterThan(3); expect(result.frames).toBeGreaterThan(0);
  console.log('Offline instrument/export measurements', result);
});

test('live playback survives note and tempo edits', async ({ page }) => {
  await page.goto('/tests/browser/liveEdit.html');
  await page.locator('#run').click();
  await expect(page.locator('#result')).toContainText('DONE', { timeout: 60000 });
  const result = await page.locator('#result').innerText();
  expect(result).not.toMatch(/FAIL|ERROR/); expect(result).toContain('PASS audio output');
});

test('online search imports licensed audio and preserves credits in a portable project', async ({ page }) => {
  // Mock only the public service; use real decodeAudioData, IndexedDB and project packing.
  const { encodeWav } = await import('../../src/engine/wav');
  const pcm = new Float32Array(4410).map((_, i) => 0.1 * Math.sin(2 * Math.PI * 440 * i / 44100));
  const wav = Buffer.from(encodeWav({ sampleRate: 44100, channels: [pcm] }));
  await page.route('https://commons.wikimedia.org/w/api.php?*', (route) => route.fulfill({ json: { query: { pages: { 1: {
    title: 'File:Test rain.wav', imageinfo: [{ url: 'https://upload.wikimedia.org/test-rain.wav', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Test_rain.wav', mime: 'audio/wav', mediatype: 'AUDIO', size: wav.length, metadata: [{ name: 'length', value: 0.1 }], extmetadata: { Artist: { value: 'Test recordist' }, LicenseShortName: { value: 'CC BY 4.0' }, LicenseUrl: { value: 'https://creativecommons.org/licenses/by/4.0/' } } }],
  } } } } }));
  await page.route('https://upload.wikimedia.org/test-rain.wav', (route) => route.fulfill({ body: wav, contentType: 'audio/wav' }));
  await fixture(page);
  if (!await page.getByRole('tab', { name: 'Online', exact: true }).isVisible()) await page.getByRole('button', { name: /Show or hide the sound browser/ }).click();
  await page.getByRole('tab', { name: 'Online', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search online sounds' }).fill('rain');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.online-sound')).toContainText('Test recordist · CC BY 4.0');
  await page.getByRole('button', { name: 'Import to library' }).click();
  await expect(page.getByRole('status').last()).toContainText('Imported Test rain');
  const packed = await page.evaluate(async () => {
    const { createAudioClip, createTrack } = await import('/src/model/project.ts');
    const { exportProjectFile, parseProjectFile } = await import('/src/state/projectFile.ts');
    const { projectCredits } = await import('/src/samples/credits.ts');
    const v = (window as any).__vibe;
    const meta = Object.values(v.library.useLibrary.getState().samples).find((s: any) => s.source === 'online') as any;
    v.useDaw.getState().update('Use downloaded sound', (p: any) => { const t = createTrack(p, 'audio'); t.clips.push(createAudioClip(p, meta.id, 0, 1)); p.tracks.push(t); });
    const p = v.useDaw.getState().project;
    const parsed = parseProjectFile(await (await exportProjectFile(p)).text());
    return { attribution: parsed.samples[0].meta.attribution, source: parsed.samples[0].meta.source, credits: projectCredits(p) };
  });
  expect(packed.source).toBe('online');
  expect(packed.attribution).toMatchObject({ author: 'Test recordist', license: 'CC BY 4.0' });
  expect(packed.credits).toContain('Test recordist');
});

test('effects can be duplicated with unique IDs and edited independently', async ({ page }) => {
  await fixture(page);
  await page.locator('.dock-head').getByRole('button', { name: /Sound & FX/ }).click();
  await page.getByRole('combobox', { name: 'Add effect', exact: true }).selectOption('parametric_eq');
  await page.getByRole('button', { name: 'Duplicate Parametric EQ', exact: true }).click();
  await expect(page.locator('.fx-card')).toHaveCount(2);
  await page.locator('.fx-card').last().getByRole('textbox', { name: 'Band 1 (dB) value', exact: true }).fill('-6');
  await expect(page.locator('.fx-card').last().getByRole('textbox', { name: 'Band 1 (dB) value', exact: true })).toHaveValue('-6');
  await page.locator('.fx-card').last().getByRole('textbox', { name: 'Band 1 (dB) value', exact: true }).press('Enter');
  const effects = await page.evaluate(() => (window as any).__vibe.useDaw.getState().project.tracks[0].effects);
  expect(effects[0].id).not.toBe(effects[1].id);
  expect(effects[0].params.gain1).toBe(0); expect(effects[1].params.gain1).toBe(-6);
  const amount = page.locator('.fx-card').last().getByRole('textbox', { name: 'Band 1 (dB) value', exact: true });
  await amount.fill('-12'); await expect(amount).toHaveValue('-12'); await amount.press('Escape');
  expect(await page.evaluate(() => (window as any).__vibe.useDaw.getState().project.tracks[0].effects[1].params.gain1)).toBe(-6);
});

async function openLibrary(page: Page) {
  const tab = page.getByRole('tab', { name: 'Library', exact: true });
  if (!await tab.isVisible()) await page.getByRole('button', { name: /Show or hide the sound browser/ }).click();
  await tab.click();
}

test('saved phrases survive reload and can be reused in another project with undo', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Clip actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Save selected clips to library', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save to library' });
  await dialog.getByRole('textbox', { name: 'Library item name' }).fill('My intro');
  await dialog.getByRole('textbox', { name: 'Library item tags' }).fill('intro, warm');
  await dialog.getByRole('button', { name: 'Save to library', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload(); await page.waitForFunction(() => !!(window as any).__vibe);
  await openLibrary(page);
  const item = page.getByRole('article', { name: 'Clip: My intro', exact: true });
  await expect(item).toContainText('intro · warm');
  await page.evaluate(async () => { const { createProject } = await import('/src/model/project.ts'); (window as any).__vibe.useDaw.getState().replaceProject(createProject('Different song')); });
  await item.getByRole('button', { name: 'Add as new track', exact: true }).click();
  await item.getByRole('button', { name: 'Add as new track', exact: true }).click();
  const loaded = await page.evaluate(() => (window as any).__vibe.useDaw.getState().project);
  expect(loaded.tracks).toHaveLength(2); expect(loaded.tracks[0].clips[0].notes).toHaveLength(8);
  expect(loaded.tracks[0].id).not.toBe(loaded.tracks[1].id);
  expect(loaded.tracks[0].clips[0].id).not.toBe(loaded.tracks[1].clips[0].id);
  await page.evaluate(() => (window as any).__vibe.useDaw.getState().undo());
  expect(await page.evaluate(() => (window as any).__vibe.useDaw.getState().project.tracks.length)).toBe(1);
});

test('effect profiles and project templates are reusable without overwriting the source', async ({ page }) => {
  await fixture(page);
  await page.locator('.dock-head').getByRole('button', { name: /Sound & FX/ }).click();
  await page.getByRole('combobox', { name: 'Add effect', exact: true }).selectOption('reverb');
  await page.getByRole('button', { name: 'Save effect profile', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Save to library' });
  await dialog.getByRole('textbox', { name: 'Library item name' }).fill('Room chain');
  await dialog.getByRole('button', { name: 'Save to library', exact: true }).click(); await expect(dialog).not.toBeVisible();
  await openLibrary(page);
  const effects = page.getByRole('article', { name: 'Effects: Room chain', exact: true });
  await effects.getByRole('button', { name: 'Add FX to track', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__vibe.useDaw.getState().project.tracks[0].effects.length)).toBe(2);
  const originalId = await page.evaluate(() => (window as any).__vibe.useDaw.getState().project.id);
  await page.getByRole('button', { name: 'Save project template', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Save to library' });
  await dialog.getByRole('textbox', { name: 'Library item name' }).fill('Starting palette');
  await dialog.getByRole('button', { name: 'Save to library', exact: true }).click(); await expect(dialog).not.toBeVisible();
  await page.getByRole('article', { name: 'Template: Starting palette', exact: true }).getByRole('button', { name: 'New project', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__vibe.useDaw.getState().project.name)).toBe('Starting palette');
  const project = await page.evaluate(() => (window as any).__vibe.useDaw.getState().project);
  expect(project.id).not.toBe(originalId); expect(project.tracks[0].effects).toHaveLength(2); expect(project.tracks[0].clips[0].notes).toHaveLength(8);
});

test('custom instructions persist and apply to every Producer mode', async ({ page }) => {
  await fixture(page);
  await openSettings(page);
  await page.getByRole('textbox', { name: 'Custom instructions', exact: true }).fill('Keep drums sparse and use warm keys.');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload(); await page.waitForFunction(() => !!(window as any).__vibe);
  const prompts = await page.evaluate(async () => { const { systemPrompt } = await import('/src/agent/prompts.ts'); return ['agent', 'ask'].map((mode) => systemPrompt(mode as any)); });
  for (const prompt of prompts) expect(prompt).toContain('Keep drums sparse and use warm keys.');
  await openSettings(page);
  await expect(page.getByRole('textbox', { name: 'Custom instructions', exact: true })).toHaveValue('Keep drums sparse and use warm keys.');
});

test('MIDI files import as editable tracks through the sound browser', async ({ page }) => {
  await fixture(page);
  const events = [0,0x90,64,100,0x83,0x60,0x80,64,0,0,0xff,0x2f,0];
  const bytes = Buffer.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,events.length,...events]);
  await page.locator('.browser input[type=file]').setInputFiles({ name: 'melody.mid', mimeType: 'audio/midi', buffer: bytes });
  await expect.poll(() => page.evaluate(() => (window as any).__vibe.useDaw.getState().project.tracks.length)).toBe(2);
  const imported = await page.evaluate(() => (window as any).__vibe.useDaw.getState().project.tracks[1]);
  expect(imported.clips[0].notes[0]).toMatchObject({ pitch: 64, start: 0, duration: 1 });
  await page.evaluate(() => (window as any).__vibe.useDaw.getState().undo());
  expect(await page.evaluate(() => (window as any).__vibe.useDaw.getState().project.tracks.length)).toBe(1);
});

async function openSettings(page: Page) {
  const settings = page.getByRole('button', { name: 'Settings: Gemini key, model, account', exact: true });
  if (await settings.isVisible()) await settings.click();
  else { await page.getByRole('button', { name: 'More', exact: true }).click(); await page.getByRole('menuitem', { name: /Settings/ }).click(); }
}

test('timed notes and lyrics work without a vocal track, persist and export as LRC', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => (window as any).__vibe.useDaw.getState().update('Empty arrangement', (p: any) => { p.tracks = []; }));
  await page.getByRole('button', { name: 'Add lyrics', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Timed note or lyrics', exact: true });
  await dialog.getByRole('textbox', { name: 'Annotation text' }).fill('We find our way home');
  await dialog.getByRole('spinbutton', { name: 'Annotation start bar' }).fill('3');
  await dialog.getByRole('spinbutton', { name: 'Annotation length bars' }).fill('2');
  await dialog.getByRole('button', { name: 'Save cue' }).click();
  await page.getByRole('button', { name: 'Add production note', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Annotation text' }).fill('Leave space for the first lyric');
  await dialog.getByRole('button', { name: 'Save cue' }).click();
  await page.locator('.dock-head').getByRole('button', { name: 'Notes & lyrics', exact: true }).click();
  await expect(page.locator('.annotation-item')).toHaveCount(2);
  await page.locator('.annotation-item').filter({ hasText: 'Leave space' }).getByRole('button', { name: 'Resolve', exact: true }).click();
  const lrc = await page.evaluate(async () => { const { exportLyrics } = await import('/src/model/annotations.ts'); return exportLyrics((window as any).__vibe.useDaw.getState().project); });
  expect(lrc).toContain('[00:03.43]'); // Eight beats at the default 140 BPM.
  expect(lrc).toContain('We find our way home');
  await expect.poll(() => page.evaluate(async () => { const { usePersist } = await import('/src/state/persistence.ts'); return usePersist.getState().saveState; })).toBe('saved');
  await page.reload(); await page.waitForFunction(() => !!(window as any).__vibe);
  const p = await page.evaluate(() => (window as any).__vibe.useDaw.getState().project);
  expect(p.tracks).toHaveLength(0); expect(p.annotations).toHaveLength(2); expect(p.annotations[1].resolved).toBe(true);
});

test('click, right-click and @ mentions attach the same current project context', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Clip actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Add selection to chat', exact: true }).click();
  await expect(page.locator('.composer .attach-chip')).toContainText('Current selection');
  const message = page.getByRole('textbox', { name: 'Message the agent' });
  await message.fill('@Intro');
  await page.getByRole('option', { name: /Intro phrase/ }).click();
  await expect(page.locator('.composer .attach-chip')).toHaveCount(2);
  await page.evaluate(() => (window as any).__vibe.useDaw.getState().update('Adjust phrase', (p: any) => { p.tracks[0].clips[0].notes[0].pitch = 67; }));
  const references = await page.evaluate(async () => { const { resolveChatReferences } = await import('/src/ui/chatReferences.ts'); return resolveChatReferences(); });
  expect(references[1].text).toContain('(67)');
  await page.getByRole('button', { name: 'Remove Intro phrase', exact: true }).click();
  // Close mobile drawer to reach the underlying timeline.
  const close = page.getByRole('button', { name: 'Close Producer panel', exact: true });
  if (await close.isVisible()) await close.click();
  await page.locator('.clip').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Add to chat', exact: true }).click();
  await expect(page.locator('.composer .attach-chip')).toHaveCount(2);
  await message.fill('@track');
  await expect(page.getByRole('listbox', { name: 'Add a project reference' })).toBeVisible();
  await message.press('ArrowDown'); await message.press('Enter');
  await expect(page.getByRole('listbox', { name: 'Add a project reference' })).not.toBeVisible();
});

test('Producer reviews remain scrollable and can be attached by mention', async ({ page }) => {
  await fixture(page);
  await page.evaluate(async () => {
    const { useAgent } = await import('/src/agent/agent.ts');
    useAgent.setState({ items: [{ id: 'review-test', kind: 'tool', name: 'listen', status: 'done', args: {}, summary: 'Reviewed the intro', heard: Array.from({ length: 60 }, (_, i) => `- Note ${i + 1}: let the kick breathe and leave space for the melody.`).join('\n') }] });
    window.dispatchEvent(new Event('vibe:open-agent'));
  });
  const notes = page.getByLabel('Producer review notes', { exact: true });
  await expect(notes).toBeVisible();
  const box = await notes.boundingBox(); expect(box!.height).toBeGreaterThan(200);
  expect(await notes.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await notes.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  expect(await notes.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const message = page.getByRole('textbox', { name: 'Message the agent' });
  await message.fill('@Reviewed'); await page.getByRole('option', { name: /Reviewed the intro/ }).click();
  await expect(page.locator('.composer .attach-chip')).toContainText('Reviewed the intro');
});

test('tooltips stay inside viewport edges with a zoomed interface and disappear on leave', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'Hover placement is a desktop interaction');
  await fixture(page);
  await page.evaluate(() => { document.getElementById('root')!.style.zoom = '1.25'; });
  const button = page.getByRole('button', { name: 'Mention a project item', exact: true });
  await button.hover();
  const tip = page.getByRole('tooltip'); await expect(tip).toBeVisible();
  const bounds = (await tip.boundingBox())!, viewport = page.viewportSize()!;
  expect(bounds.x).toBeGreaterThanOrEqual(7); expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 7);
  expect(bounds.y).toBeGreaterThanOrEqual(7); expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 7);
  await page.mouse.move(0, 0); await expect(tip).not.toBeVisible();
});

test('toolbar menus fit, edit clips, and keep timeline controls reachable', async ({ page }) => {
  await fixture(page);
  for (const width of [1440, 1100, 820, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const fits = await page.locator('.arrange-tools').evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight);
    expect(fits, `toolbar at ${width}px`).toBe(true);
  }
  await page.getByRole('button', { name: 'Clip actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate selected clips', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__vibe.useDaw.getState().project.tracks[0].clips.length)).toBe(2);
  await page.getByRole('button', { name: 'Timeline view', exact: true }).click();
  const follow = page.getByRole('menuitemcheckbox', { name: 'Follow playhead', exact: true });
  await expect(follow).toHaveAttribute('aria-checked', 'true');
  await follow.click();
  await expect(follow).toHaveAttribute('aria-checked', 'false');
  expect(await page.evaluate(() => (window as any).__vibe.useDaw.getState().followPlayhead)).toBe(false);
  await page.getByRole('menu', { name: 'Timeline view', exact: true }).getByRole('combobox', { name: 'Snap', exact: true }).selectOption('0.5');
  expect(await page.evaluate(() => (window as any).__vibe.useDaw.getState().snap)).toBe(0.5);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Timeline view', exact: true })).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Timeline view', exact: true })).toBeFocused();
  await page.evaluate(() => { document.getElementById('root')!.style.zoom = '1.25'; });
  await page.getByRole('button', { name: 'Clip actions', exact: true }).press('ArrowDown');
  const bounds = (await page.getByRole('menu', { name: 'Clip actions', exact: true }).boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(7);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width - 7);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height - 7);
  await page.keyboard.press('Escape');
});

test('model menu uses the shared UI and preserves the selected model', async ({ page }) => {
  await fixture(page);
  await page.evaluate(() => window.dispatchEvent(new Event('vibe:open-agent')));
  await page.getByRole('button', { name: 'Model', exact: true }).click();
  const menu = page.getByRole('listbox', { name: 'Model', exact: true });
  const bounds = (await menu.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(7);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height - 7);
  await page.getByRole('option', { name: /Gemini 4 Argon/ }).click();
  await expect(page.getByRole('button', { name: 'Model', exact: true })).toContainText('Gemini 4 Argon');
  await page.reload(); await page.waitForFunction(() => !!(window as any).__vibe);
  await page.evaluate(() => window.dispatchEvent(new Event('vibe:open-agent')));
  await expect(page.getByRole('button', { name: 'Model', exact: true })).toContainText('Gemini 4 Argon');
});

test('landing mixer fits and brand animation continues on hover', async ({ page }, info) => {
  await page.goto('/');
  const mixer = page.locator('.lp-mixer');
  await mixer.scrollIntoViewIfNeeded();
  await expect(mixer.locator('img')).toBeVisible();
  await mixer.locator('img').evaluate((img) => (img as HTMLImageElement).decode());
  expect(await mixer.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
  expect(await mixer.locator('img').evaluate((el) => Math.abs((el as HTMLElement).offsetWidth - el.parentElement!.clientWidth) < 2)).toBe(true);
  expect(await page.locator('.landing').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  if (info.project.name === 'desktop') {
    await page.locator('.lp-wordmark-wrap').hover();
    await expect(page.locator('.lp-wordmark-wrap')).toHaveAttribute('data-lp-motion', 'running');
    expect(await page.locator('.lp-wordmark .vibe-letter').first().evaluate((el) => getComputedStyle(el).animationPlayState.split(',').every(state => state.trim() === 'running'))).toBe(true);
  }
});
