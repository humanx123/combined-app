// The demo session the marketing captures show: "Late night drive", built
// through the same agent tools the Producer uses, so the studio is the live
// app. Only the Producer chat is seeded (no LLM call): its tool rows are the
// real tool results. Shared by capture-landing-screenshots.mjs and the App
// Store pipeline (scripts/screenshots/).
export const buildSession = (page) => page.evaluate(async () => {
  const { tools, useDaw } = window.__vibe;
  const { createProject } = await import('/src/model/project.ts');
  const { useAgent } = await import('/src/agent/agent.ts');
  const { diffProjects } = await import('/src/agent/diff.ts');
  useDaw.getState().replaceProject(createProject('Late night drive'));
  const ctx = { signal: new AbortController().signal, goal: '' };
  const run = async (name, args) => {
    const out = await tools.runTool(name, args, ctx, 'agent');
    if (out.result.error) throw new Error(`${name}: ${out.result.error}`);
    return out;
  };
  const keep = () => useDaw.getState().update('Keep', (d) => {
    for (const t of d.tracks) for (const c of t.clips) delete c.aiPending;
    for (const a of d.annotations ?? []) delete a.aiPending;
  });

  await run('set_project', { bpm: 84, key: 'F minor', swing: 0.22 });
  const drums = (await run('create_track', { name: 'Dusty drums', kind: 'drums', kit: 'lofi' })).result.track_id;
  const keys = (await run('create_track', { name: 'Rhodes', kind: 'instrument', preset: 'epiano', volume_db: -8 })).result.track_id;
  const bass = (await run('create_track', { name: 'Upright-ish bass', kind: 'instrument', preset: 'electric_bass', volume_db: -7 })).result.track_id;
  const pad = (await run('create_track', { name: 'Glass pad', kind: 'instrument', preset: 'glass_pad', volume_db: -14, pan: -0.2 })).result.track_id;

  const prog = (oct, extra = {}) => [['Fm9', 0], ['Dbmaj7', 4], ['Bbm9', 8], ['C7', 12]].map(([chord, start]) => ({ chord, start, duration: 3.75, octave: oct, voicing: 'voice_lead', ...extra }));
  const groove = [
    { lane: 'kick', pattern: 'x.....x...x..... x.......x..x....' },
    { lane: 'snare', pattern: '....x.......x... ....x.......x..o' },
    { lane: 'hat', pattern: 'x.xox.x.x.xox.x.' , velocity: 0.6 },
    { lane: 'rim', pattern: '..........x.....', velocity: 0.5 },
  ];
  await run('write_drums', { track_id: drums, start_bar: 5, length_bars: 8, clip_name: 'Verse groove', lanes: groove });
  await run('write_drums', { track_id: drums, start_bar: 13, length_bars: 8, clip_name: 'Hook groove', lanes: [...groove, { lane: 'shaker', pattern: 'x.x.x.x.x.x.x.x.', velocity: 0.4 }] });
  await run('write_notes', { track_id: keys, start_bar: 1, length_bars: 4, clip_name: 'Intro chords', chords: prog(3, { strum: 0.04 }) });
  await run('write_notes', { track_id: keys, start_bar: 5, length_bars: 16, clip_name: 'Rhodes comp', chords: prog(3, { strum: 0.03 }), loop_bars: 4 });
  await run('write_notes', { track_id: bass, start_bar: 5, length_bars: 16, clip_name: 'Walking bass', loop_bars: 4, notes: [
    ['F2', 0, 1.5], ['C2', 1.5, 0.5], ['Eb2', 2.5, 1], ['Db2', 4, 1.5], ['Ab1', 5.5, 0.5], ['C2', 6.5, 1], ['Bb1', 8, 1.5], ['F2', 9.5, 0.5], ['Db2', 10.5, 1], ['C2', 12, 1.5], ['E2', 13.5, 0.5], ['G2', 14.5, 1],
  ].map(([pitch, start, duration]) => ({ pitch, start, duration, velocity: 0.8 })) });
  await run('write_notes', { track_id: pad, start_bar: 1, length_bars: 20, clip_name: 'Glass bed', chords: prog(4, { duration: 4, velocity: 0.5 }), loop_bars: 4 });
  await run('set_sections', { sections: [{ name: 'Intro', start_bar: 1, length_bars: 4 }, { name: 'Verse', start_bar: 5, length_bars: 8 }, { name: 'Hook', start_bar: 13, length_bars: 8 }] });
  for (const [text, start_bar, end_bar] of [['city lights', 13, 15], ['nobody awake', 15, 17], ['just the radio', 17, 19]]) await run('add_annotation', { text, kind: 'lyric', start_bar, end_bar });
  await run('add_annotation', { text: 'Leave room for the vocal here', kind: 'note', start_bar: 5, end_bar: 9 });
  await run('add_effect', { track_id: keys, type: 'chorus' });
  await run('add_effect', { track_id: keys, type: 'lofi' });
  await run('add_effect', { track_id: drums, type: 'saturation' });
  await run('add_effect', { track_id: pad, type: 'reverb' });
  await run('add_effect', { track_id: bass, type: 'duck', params: { source: drums } });
  keep();

  // The Producer's last run: a melody that is still waiting to be kept.
  const checkpoint = useDaw.getState().project;
  const runItems = [];
  const lead = await run('create_track', { name: 'Flute hook', kind: 'instrument', preset: 'flute', volume_db: -9, pan: 0.15 });
  const melody = await run('write_notes', { track_id: lead.result.track_id, start_bar: 13, length_bars: 8, clip_name: 'Hook melody', loop_bars: 4, notes: [
    ['C5', 0, 0.75], ['Ab4', 0.75, 0.5], ['G4', 1.5, 0.5], ['F4', 2, 1.5], ['Ab4', 4, 0.5], ['Bb4', 4.5, 0.5], ['C5', 5, 1], ['Eb5', 6, 1.5],
    ['Db5', 8, 0.75], ['C5', 8.75, 0.5], ['Bb4', 9.5, 1], ['F4', 10.5, 1.25], ['G4', 12, 0.5], ['Ab4', 12.5, 0.5], ['Bb4', 13, 0.5], ['C5', 13.5, 2],
  ].map(([pitch, start, duration]) => ({ pitch, start, duration, velocity: 0.75 })) });
  const delay = await run('add_effect', { track_id: lead.result.track_id, type: 'delay' });
  const id = (n) => `shot${n}`;
  runItems.push({ kind: 'user', id: id(1), text: 'Give the hook a breathy flute melody. Keep it simple, I want space for vocals.', checkpoint });
  for (const [i, [name, args, out]] of [
    ['create_track', { name: 'Flute hook' }, lead],
    ['write_notes', {}, melody],
    ['add_effect', {}, delay],
  ].entries()) runItems.push({ kind: 'tool', id: id(10 + i), name, args, status: 'done', summary: out.summary, clipIds: out.clipIds });
  runItems.push({ kind: 'tool', id: id(20), name: 'listen', args: {}, status: 'done', summary: 'Listened to bars 13–20', heard: 'The flute sits just above the Rhodes and leaves the 2–4 kHz pocket open for a vocal. Hook resolves cleanly back to F.' });
  runItems.push({ kind: 'assistant', id: id(30), text: 'Added a **flute hook** over bars 13–20: a four-bar phrase that answers itself, mostly stepwise so it stays out of the way of a vocal. A dotted-eighth delay gives it some air. Have a listen and keep what you like.', thinking: '', streaming: false });
  runItems.push({ kind: 'changes', id: id(40), lines: diffProjects(checkpoint, useDaw.getState().project).lines, checkpoint, state: 'pending' });
  useAgent.setState({ items: runItems });
  const t = (name) => useDaw.getState().project.tracks.find((x) => x.name === name);
  return { drums, keys, bass, pad, lead: lead.result.track_id, melodyClip: melody.clipIds[0], hookDrums: t('Dusty drums').clips.find((c) => c.name === 'Hook groove').id };
});
