import { describe, expect, it, vi } from 'vitest';
vi.mock('../engine/api', () => ({ play: vi.fn(), stop: vi.fn(), renderProject: vi.fn() }));
vi.mock('./ears', () => ({ audition: vi.fn(), listen: vi.fn() }));
import { runTool, toolDeclarations, type PlanStep } from './tools';

const plan: PlanStep[] = [{ title: 'Build drums', status: 'active' }, { title: 'Balance bass', status: 'pending' }];
const context = () => ({ signal: new AbortController().signal, goal: 'Make a beat', plan });

describe('producer skills', () => {
  it('reads one task or genre guide without changing the project, including Ask mode', async () => {
    const before = useDaw.getState().project;
    const task = await runTool('get_producer_skill', { name: 'rhythm' }, context(), 'ask');
    expect(task.result.guide).toContain('steps_per_bar');
    const genre = await runTool('get_producer_skill', { name: 'house' }, context(), 'agent');
    expect(genre.result.guide).toContain('Four-on-the-floor');
    expect(useDaw.getState().project).toBe(before);
    expect((await runTool('get_producer_skill', { name: '__proto__' }, context(), 'agent')).result).toHaveProperty('error');
  });
});

describe('checklist tool', () => {
  it('creates a checklist and returns its canonical state', async () => {
    const out = await runTool('update_plan', { steps: plan }, context(), 'agent');
    expect(out.plan).toEqual(plan);
    expect(out.result.steps).toEqual(plan);
  });

  it('updates individual steps atomically without losing or mutating the rest', async () => {
    const out = await runTool('update_plan', { updates: [{ step: 1, status: 'done' }, { step: 2, status: 'active', title: 'Balance kick and bass' }] }, context(), 'agent');
    expect(out.plan).toEqual([{ title: 'Build drums', status: 'done' }, { title: 'Balance kick and bass', status: 'active' }]);
    expect(plan[0].status).toBe('active');
    expect(plan[1].title).toBe('Balance bass');
    const single = await runTool('update_plan', { updates: [{ step: 2, status: 'active' }] }, context(), 'agent');
    expect(single.plan?.[0]).toEqual(plan[0]);
  });

  it('permits progress updates in Ask mode without changing the project', async () => {
    expect(toolDeclarations('ask').some((t) => t.name === 'update_plan')).toBe(true);
    const out = await runTool('update_plan', { updates: [{ step: 1, status: 'done' }] }, context(), 'ask');
    expect(out.plan?.[0].status).toBe('done');
  });

  it.each([
    {}, { steps: [] }, { steps: plan, updates: [] },
    { updates: [{ step: 0, status: 'done' }] },
    { updates: [{ step: 3, status: 'done' }] },
    { updates: [{ step: 1.5, status: 'done' }] },
    { updates: [{ step: 1, status: 'finished' }] },
    { updates: [{ step: 1, status: 'done' }, { step: 2, status: 'active', title: ' ' }] },
    { steps: [null] }, { steps: [{ title: '', status: 'done' }] },
  ])('rejects invalid updates without publishing partial progress: %j', async (args) => {
    const out = await runTool('update_plan', args, context(), 'agent');
    expect(out.result).toHaveProperty('error');
    expect(out.plan).toBeUndefined();
    expect(plan[0].status).toBe('active');
  });

  it('requires an existing checklist before patching steps', async () => {
    const out = await runTool('update_plan', { updates: [{ step: 1, status: 'done' }] }, { ...context(), plan: undefined }, 'agent');
    expect(out.result.error).toContain('Create a checklist');
  });
});

import { createProject } from '../model/project';
import { useDaw } from '../state/store';

describe('annotation tools', () => {
  it('writes timed lyrics with no audio track, supports editing/resolve/delete and one-step undo', async () => {
    useDaw.getState().replaceProject(createProject());
    useDaw.getState().beginTransaction('Producer writing cues');
    const added = await runTool('add_annotation', { text: 'Under the city lights', kind: 'lyric', start_bar: 3, end_bar: 5 }, context(), 'agent');
    const id = added.result.annotation_id;
    expect(useDaw.getState().project.annotations?.[0]).toMatchObject({ id, start: 8, length: 8, author: 'producer', aiPending: true });
    await runTool('edit_annotation', { annotation_id: id, text: 'Under neon skies', end_bar: 4 }, context(), 'agent');
    const read = await runTool('list_annotations', { start_bar: 3, end_bar: 5 }, context(), 'ask');
    expect(read.result.annotations).toMatchObject([{ text: 'Under neon skies', length: 4 }]);
    const blocked = await runTool('delete_annotation', { annotation_id: id }, context(), 'ask');
    expect(blocked.result.error).toContain('read-only');
    useDaw.getState().endTransaction(); useDaw.getState().undo();
    expect(useDaw.getState().project.annotations).toEqual([]);
    useDaw.getState().redo();
    await runTool('delete_annotation', { annotation_id: id }, context(), 'agent');
    expect(useDaw.getState().project.annotations).toEqual([]);
  });
  it('rejects invalid text, timing, association or kind without partial writes', async () => {
    useDaw.getState().replaceProject(createProject());
    for (const patch of [{ text: ' ' }, { end_bar: 1 }, { start_bar: -1 }, { kind: 'vocal' }, { track_id: 'missing' }, { text: 'x'.repeat(4001) }]) {
      const result = await runTool('add_annotation', { text: 'note', kind: 'note', start_bar: 1, end_bar: 2, ...patch }, context(), 'agent');
      expect(result.result).toHaveProperty('error');
    }
    expect(useDaw.getState().project.annotations).toEqual([]);
  });
});

describe('custom effect tools', () => {
  const custom = { name: 'Gain', code: 'function process(l, r, p) { for (let i = 0; i < l.length; i++) { l[i] *= p.g; r[i] *= p.g; } }', params: [{ id: 'g', label: 'Gain', min: 0, max: 2, default: 1 }] };
  const setup = () => { useDaw.getState().replaceProject(createProject()); return useDaw.getState().project; };

  it('adds a tested custom effect with its definition and knob values', async () => {
    setup();
    const out = await runTool('add_effect', { track_id: 'master', type: 'custom', custom, knobs: [{ id: 'g', value: 1.5 }] }, context(), 'agent');
    expect(out.summary).toBe('Gain on master');
    const fx = useDaw.getState().project.master.effects.find((e) => e.type === 'custom')!;
    expect(fx).toMatchObject({ params: { g: 1.5 }, custom: { name: 'Gain', params: custom.params } });
    expect(useDaw.getState().project.master.effects.at(-1)!.type).toBe('limiter');
    const read = await runTool('get_custom_effect', { effect_id: fx.id }, context(), 'ask');
    expect(read.result).toMatchObject({ code: custom.code, values: { g: 1.5 } });
  });

  it('returns code errors to the agent without changing the project', async () => {
    const before = setup();
    const out = await runTool('add_effect', { track_id: 'master', type: 'custom', custom: { ...custom, code: 'function process(l) { l.nope(); }' } }, context(), 'agent');
    expect(out.result.error).toMatch(/failed its test run: TypeError/);
    expect(useDaw.getState().project).toBe(before);
    expect((await runTool('add_effect', { track_id: 'master', type: 'custom', custom: { ...custom, params: [{ id: 'g g', min: 0, max: 1, default: 0 }] } }, context(), 'agent')).result.error).toMatch(/identifier/);
    expect((await runTool('add_effect', { track_id: 'master', type: 'reverb', custom }, context(), 'agent')).result.error).toMatch(/only for type "custom"/);
  });

  it('rewrites code and keeps surviving knob values', async () => {
    setup();
    const id = (await runTool('add_effect', { track_id: 'master', type: 'custom', custom, knobs: [{ id: 'g', value: 0.5 }] }, context(), 'agent')).result.effect_id as string;
    const out = await runTool('update_effect', { effect_id: id, custom: { name: 'Gain 2', params: [...custom.params, { id: 'mix', label: 'Mix', min: 0, max: 1, default: 1 }] } }, context(), 'agent');
    expect(out.summary).toMatch(/^Gain 2: new code/);
    const fx = useDaw.getState().project.master.effects.find((e) => e.id === id)!;
    expect(fx.params).toEqual({ g: 0.5, mix: 1 });
    expect((await runTool('update_effect', { effect_id: id, knobs: [{ id: 'nope', value: 1 }] }, context(), 'agent')).result.error).toMatch(/no knob "nope"/);
  });
});
