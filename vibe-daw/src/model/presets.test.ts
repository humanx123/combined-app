import { describe, expect, it } from 'vitest';
import { capturePreset, insertPreset } from './presets';
import { createMidiClip, createProject, createTrack, mintId } from './project';
import { CUSTOM_STARTERS, newCustomEffect } from './customEffect';
import { validateProject } from './validate';
function fixture() {
  const p = createProject(); const t = createTrack(p, 'instrument', { preset: 'epiano' });
  const c = createMidiClip(p, 8, 8); c.aiPending = true;
  c.notes = [0, 2, 4, 6].map((start) => ({ id: `n${start}`, pitch: 60, start, duration: 1, velocity: 0.7 }));
  t.effects.push({ id: 'fx100', type: 'duck', enabled: true, params: { source: 'other-track' } });
  t.clips.push(c); p.tracks.push(t); return { p, t, c };
}
describe('reusable preset snapshots', () => {
  it('captures only a selected phrase with its sound and keeps the source untouched', () => {
    const { p, t, c } = fixture();
    const saved = capturePreset(p, 'clip', { selection: { clipIds: [c.id], range: { start: 10, end: 13, trackIds: [t.id] } } });
    expect(saved.tracks[0].clips[0]).toMatchObject({ start: 0, length: 3, notes: [{ start: 0 }, { start: 2 }] });
    expect(saved.tracks[0].instrument?.preset).toBe('epiano');
    expect(saved.tracks[0].clips[0].aiPending).toBeUndefined(); expect(c.aiPending).toBe(true);
    expect(c.start).toBe(8); validateProject(saved);
  });
  it('loads repeated instances with fresh IDs and disables external sidechain references', () => {
    const { p, c } = fixture(); const saved = capturePreset(p, 'clip', { selection: { clipIds: [c.id] } });
    const dest = createProject(); insertPreset(dest, saved, 'clip', { at: 16 }); insertPreset(dest, saved, 'clip', { at: 24 });
    expect(dest.tracks.map((t) => t.clips[0].start)).toEqual([16, 24]);
    expect(dest.tracks[0].effects[0]).toMatchObject({ enabled: false, params: { source: '' } });
    expect(dest.tracks[0].clips[0].id).not.toBe(dest.tracks[1].clips[0].id); validateProject(dest);
  });
  it('applies track sounds without replacing the existing composition', () => {
    const { p, t, c } = fixture(); const saved = capturePreset(p, 'sound', { trackId: t.id });
    t.instrument!.preset = 'pluck';
    insertPreset(p, saved, 'sound', { targetTrackId: t.id });
    expect(t.instrument?.preset).toBe('epiano'); expect(t.clips).toEqual([c]);
  });
  it('adds master effect profiles before the limiter and replaces only when requested', () => {
    const { p, t } = fixture(); t.effects = [{ id: 'fx100', type: 'reverb', enabled: true, params: { decay: 3 } }];
    const saved = capturePreset(p, 'effects', { trackId: t.id }), dest = createProject();
    insertPreset(dest, saved, 'effects', { targetTrackId: 'master' });
    expect(dest.master.effects.map((e) => e.type)).toEqual(['reverb', 'limiter']);
    insertPreset(dest, saved, 'effects', { targetTrackId: 'master', replaceEffects: true });
    expect(dest.master.effects.map((e) => e.type)).toEqual(['reverb']); validateProject(dest);
  });
});

describe('plugin presets', () => {
  it('captures one effect, with its custom definition, and inserts a fresh copy', () => {
    const p = createProject();
    const fx = newCustomEffect(mintId(p, 'fx'), CUSTOM_STARTERS[1].def);
    p.master.effects.unshift(fx);
    const saved = capturePreset(p, 'effects', { effectId: fx.id });
    expect(saved.master.effects).toEqual([fx]);
    const target = createProject();
    insertPreset(target, saved, 'effects', { targetTrackId: 'master' });
    const added = target.master.effects.find((e) => e.type === 'custom')!;
    expect(added.custom).toEqual(fx.custom);
    expect(() => capturePreset(p, 'effects', { effectId: 'missing' })).toThrow(/no longer exists/);
  });
});
