import { describe, expect, it } from 'vitest';
import { CUSTOM_STARTERS, customValues, newCustomEffect, rebaseCustomValues, validateCustomEffect } from './customEffect';
import { createProject } from './project';
import { validateProject } from './validate';

const starter = CUSTOM_STARTERS[0].def;

describe('custom effect definitions', () => {
  it('accepts the starters and normalizes labels and defaults', () => {
    for (const { def } of CUSTOM_STARTERS) expect(validateCustomEffect(def)).toEqual(def);
    expect(validateCustomEffect({ name: ' Gain ', code: 'function process() {}', params: [{ id: 'g', min: 0, max: 2 }] }))
      .toEqual({ name: 'Gain', code: 'function process() {}', params: [{ id: 'g', label: 'g', min: 0, max: 2, default: 0 }] });
  });

  it.each([
    [{ ...starter, name: '' }, /name/],
    [{ ...starter, code: 'x'.repeat(20_001) }, /under 20k/],
    [{ ...starter, params: [{ id: '1bad', min: 0, max: 1 }] }, /identifier/],
    [{ ...starter, params: [{ id: 'a', min: 0, max: 1 }, { id: 'a', min: 0, max: 1 }] }, /twice/],
    [{ ...starter, params: [{ id: 'a', min: 1, max: 1 }] }, /min < max/],
    [{ ...starter, params: [{ id: 'a', min: 0, max: 1, default: 2 }] }, /between/],
  ])('rejects invalid definitions with a usable message', (def, message) => {
    expect(() => validateCustomEffect(def)).toThrow(message);
  });

  it('clamps knob values and keeps surviving ones across edits', () => {
    expect(customValues(starter, { drive: 9, mix: 'x', extra: 1 })).toEqual({ drive: 1, mix: 1 });
    const edited = { ...starter, params: [starter.params[0], { id: 'tone', label: 'Tone', min: 0, max: 1, default: 0.5 }] };
    expect(rebaseCustomValues(edited, { drive: 0.8, mix: 0.2 })).toEqual({ drive: 0.8, tone: 0.5 });
  });

  it('round-trips through project validation and rejects broken ones', () => {
    const p = createProject();
    p.master.effects = [newCustomEffect('fx90', starter)];
    expect(validateProject(structuredClone(p)).master.effects[0].custom).toEqual(starter);
    p.master.effects[0].custom = { ...starter, params: [{ id: 'bad id', label: 'x', min: 0, max: 1, default: 0 }] };
    expect(() => validateProject(p)).toThrow(/custom/);
    p.master.effects = [{ id: 'fx91', type: 'eq', enabled: true, params: {}, custom: starter }];
    expect(() => validateProject(p)).toThrow(/custom/);
  });
});
