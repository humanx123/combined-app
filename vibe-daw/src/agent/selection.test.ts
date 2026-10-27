import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../engine/api', () => ({ play: vi.fn(), stop: vi.fn(), renderProject: vi.fn() }));
vi.mock('./ears', () => ({ audition: vi.fn(), listen: vi.fn() }));
import { runTool } from './tools';
import { useDaw } from '../state/store';
import { createMidiClip, createProject, createTrack } from '../model/project';
import type { EditSelection } from '../model/selection';

function fixture() {
  const p = createProject(); const t = createTrack(p, 'drums'); const c = createMidiClip(p, 8, 8);
  c.notes = [0, 1, 2, 3].map((start) => ({ id: `n${start}`, pitch: 36, start, duration: 0.25, velocity: 0.8 }));
  t.clips.push(c); p.tracks.push(t); useDaw.getState().replaceProject(p);
  const selection: EditSelection = { clipIds: [c.id], range: { start: 9, end: 11, trackIds: [t.id] } };
  return { p, c, ctx: { selection, signal: new AbortController().signal, goal: 'Improve this intro' } };
}
beforeEach(() => useDaw.getState().endTransaction());
describe('editing selected notes', () => {
  it('replaces only selected notes in place and undoes the entire run together', async () => {
    const { p, c, ctx } = fixture();
    useDaw.getState().beginTransaction('AI selection edit');
    const out = await runTool('replace_selected_notes', { clip_id: c.id, notes: [{ pitch: 'D2', start: 1.5, duration: 0.25 }] }, ctx, 'agent');
    expect(out.result).toMatchObject({ ok: true, replaced: 2 });
    const current = () => useDaw.getState().project.tracks[0].clips[0];
    expect(current()).toMatchObject({ id: c.id, start: 8, length: 8, aiPending: true });
    expect(current().type === 'midi' && current()).toMatchObject({ notes: [c.notes[0], c.notes[3], { pitch: 38, start: 1.5 }] });
    const transformed = await runTool('transform_notes', { clip_id: c.id, operation: 'velocity', amount: 0.4 }, ctx, 'agent');
    expect(transformed.result.error).toBeUndefined();
    expect(current()).toMatchObject({ notes: [c.notes[0], c.notes[3], { velocity: 0.4 }] });
    useDaw.getState().endTransaction(); useDaw.getState().undo();
    expect(useDaw.getState().project.tracks).toEqual(p.tracks);
  });
  it.each([
    [{ pitch: 36, start: 0, duration: 0.25 }],
    [{ pitch: 36, start: 2.9, duration: 1 }],
    [{ pitch: 36, start: 1, duration: NaN }],
    [{ pitch: 36, start: 1, duration: 1, velocity: 8 }],
    [null],
  ])('rejects invalid or out-of-range replacements atomically', async (notes) => {
    const { p, c, ctx } = fixture();
    const out = await runTool('replace_selected_notes', { clip_id: c.id, notes }, ctx, 'agent');
    expect(out.result.error).toBeTruthy(); expect(useDaw.getState().project).toBe(p);
  });
  it('does not edit in Ask mode and requires an active selection', async () => {
    const { p, c, ctx } = fixture();
    const args = { clip_id: c.id, notes: [] };
    expect((await runTool('replace_selected_notes', args, ctx, 'ask')).result.error).toBeTruthy();
    expect((await runTool('replace_selected_notes', args, { ...ctx, selection: undefined }, 'agent')).result.error).toBeTruthy();
    expect(useDaw.getState().project).toBe(p);
  });
});

describe('temporal edits within a phrase', () => {
  it('reverses selected notes around the selected range and preserves surrounding hits', async () => {
    const { c, ctx } = fixture();
    const out = await runTool('transform_notes', { clip_id: c.id, operation: 'reverse' }, ctx, 'agent');
    expect(out.result.error).toBeUndefined();
    const edited = useDaw.getState().project.tracks[0].clips[0];
    if (edited.type !== 'midi') throw new Error('Expected MIDI');
    expect(edited.notes.find((n) => n.id === 'n1')?.start).toBe(2.75);
    expect(edited.notes.find((n) => n.id === 'n2')?.start).toBe(1.75);
    expect(edited.notes.filter((n) => ['n0', 'n3'].includes(n.id))).toEqual([c.notes[0], c.notes[3]]);
  });
});
