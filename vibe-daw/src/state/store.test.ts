import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDaw } from './store';
import { createProject } from '../model/project';

beforeEach(() => { vi.restoreAllMocks(); useDaw.getState().replaceProject(createProject()); });

describe('undo history', () => {
  it('does not save, resync or consume history for an unchanged edit', () => {
    const p = useDaw.getState().project;
    const listener = vi.fn();
    const unsubscribe = useDaw.subscribe(listener);
    useDaw.getState().update('No change', (d) => { d.bpm = p.bpm; });
    expect(useDaw.getState().project).toBe(p);
    expect(useDaw.getState().past).toHaveLength(0);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
  it('keeps redo and the full history when an empty transaction ends', () => {
    useDaw.getState().update('Name', (d) => { d.name = 'Edited'; });
    useDaw.getState().undo();
    const before = useDaw.getState();
    useDaw.getState().beginTransaction('Ask');
    useDaw.getState().endTransaction();
    expect(useDaw.getState().past).toBe(before.past);
    expect(useDaw.getState().future).toBe(before.future);
    useDaw.getState().redo();
    expect(useDaw.getState().project.name).toBe('Edited');
  });
  it('groups a run into one undo and never coalesces the next manual edit into it', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const daw = useDaw.getState();
    daw.beginTransaction('Volume');
    daw.update('Volume', (d) => { d.master.volumeDb = -4; });
    daw.update('Volume', (d) => { d.master.volumeDb = -8; });
    daw.endTransaction();
    daw.update('Volume', (d) => { d.master.volumeDb = -10; }, { coalesce: true });
    expect(useDaw.getState().past).toHaveLength(2);
    daw.undo();
    expect(useDaw.getState().project.master.volumeDb).toBe(-8);
    daw.undo();
    expect(useDaw.getState().project.master.volumeDb).toBe(0);
  });
  it('resets coalescing and an active transaction when changing projects', () => {
    useDaw.getState().beginTransaction('Agent');
    useDaw.getState().replaceProject(createProject('New'));
    useDaw.getState().update('Agent', (d) => { d.bpm = 120; }, { coalesce: true });
    expect(useDaw.getState().transaction).toBeNull();
    expect(useDaw.getState().past).toHaveLength(1);
  });
});
