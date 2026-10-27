import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LlmRequest, LlmResult } from './llm';
const mocks = vi.hoisted(() => ({ stream: vi.fn(), tool: vi.fn(), listening: false }));
vi.mock('./llm', () => ({ streamGenerate: mocks.stream, explainError: (e: Error) => e.message }));
vi.mock('./tools', () => ({ runTool: mocks.tool, toolDeclarations: () => mocks.listening ? [{ name: 'listen' }] : [] }));
vi.mock('./prompts', () => ({ systemPrompt: () => 'Producer' }));
vi.mock('../state/settings', () => ({ aiAvailable: () => ({ ok: true }), useSettings: { getState: () => ({ thinking: 'LOW' }) } }));
import { keepChanges, revertTo, runAgent, steerAgent, stopAgent, useAgent } from './agent';
import { useDaw } from '../state/store';
import { createProject } from '../model/project';
import type { PlanStep } from './tools';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { resolve, promise };
}
const answer = (): LlmResult => ({ content: { role: 'model', parts: [{ text: 'Done' }] } });
const calls = (): LlmResult => ({ content: { role: 'model', parts: [{ thoughtSignature: 'sig', functionCall: { name: 'edit', id: 'a' } }, { functionCall: { name: 'edit', id: 'b' } }] } });

beforeEach(() => { mocks.stream.mockReset(); mocks.tool.mockReset(); mocks.listening = false; useAgent.getState().clear(); useDaw.getState().replaceProject(createProject()); });

describe('agent steering', () => {
  it('accepts follow-ups while streaming and skips stale tool calls before replanning', async () => {
    const first = deferred<LlmResult>();
    mocks.stream.mockReturnValueOnce(first.promise).mockResolvedValueOnce(answer());
    const run = runAgent('Make a beat');
    await runAgent('Keep it slow');
    expect(steerAgent('No extra hats')).toBe(true);
    expect(useAgent.getState().steering).toHaveLength(2);
    first.resolve(calls());
    await run;
    expect(mocks.tool).not.toHaveBeenCalled();
    const second = mocks.stream.mock.calls[1][0] as LlmRequest;
    expect(JSON.stringify(second.contents)).toContain('No extra hats');
    expect(JSON.stringify(second.contents)).toContain('Keep it slow');
    expect(JSON.stringify(second.contents)).toContain('Skipped because');
    expect(JSON.stringify(second.contents)).toContain('sig');
    expect(useAgent.getState().running).toBe(false);
    expect(useAgent.getState().items.filter((i) => i.kind === 'user' && i.steering === 'applied')).toHaveLength(2);
  });
  it('finishes the current tool and skips the remaining batch when steering arrives', async () => {
    const current = deferred<{ result: { ok: boolean }; summary: string }>();
    mocks.stream.mockResolvedValueOnce(calls()).mockResolvedValueOnce(answer());
    mocks.tool.mockReturnValueOnce(current.promise);
    const run = runAgent('Make a beat');
    await vi.waitFor(() => expect(mocks.tool).toHaveBeenCalledTimes(1));
    steerAgent('Make the bass quieter');
    current.resolve({ result: { ok: true }, summary: 'Edited' });
    await run;
    expect(mocks.tool).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.stream.mock.calls[1][0].contents)).toContain('bass quieter');
  });
  it('stops cleanly without executing buffered calls or losing the undo boundary', async () => {
    const first = deferred<LlmResult>();
    mocks.stream.mockReturnValueOnce(first.promise);
    const run = runAgent('Make a beat');
    steerAgent('Stay in C minor');
    stopAgent(); first.resolve(calls());
    await run;
    expect(mocks.tool).not.toHaveBeenCalled();
    expect(useAgent.getState().items.some((i) => i.kind === 'user' && i.steering === 'cancelled')).toBe(true);
    expect(useDaw.getState().transaction).toBeNull();
  });
  it('does not restore old history or mutate a newly opened project after clear', async () => {
    const first = deferred<LlmResult>();
    mocks.stream.mockReturnValueOnce(first.promise);
    const run = runAgent('Make a beat');
    useAgent.getState().clear();
    useDaw.getState().replaceProject(createProject('Other project'));
    first.resolve(calls()); await run;
    expect(mocks.tool).not.toHaveBeenCalled();
    expect(useAgent.getState().items).toEqual([]);
    expect(useDaw.getState().project.name).toBe('Other project');
  });
});

describe('live checklist', () => {
  it('updates the same card during work and supplies the latest state after compaction', async () => {
    const initial: PlanStep[] = [{ title: 'Build drums', status: 'active' }, { title: 'Balance bass', status: 'pending' }];
    const updated: PlanStep[] = [{ title: 'Build drums', status: 'done' }, { title: 'Balance bass', status: 'active' }];
    const final = deferred<LlmResult>();
    const planCall = (): LlmResult => ({ content: { role: 'model', parts: [{ functionCall: { name: 'update_plan', args: {} } }] } });
    mocks.stream.mockResolvedValueOnce(planCall()).mockResolvedValueOnce({ content: { role: 'model', parts: [
      { functionCall: { name: 'update_plan', args: { updates: [{ step: 1, status: 'done' }, { step: 2, status: 'active' }] } } },
      { functionCall: { name: 'manage_context', args: { action: 'compact' } } },
    ] } }).mockReturnValueOnce(final.promise);
    mocks.tool.mockResolvedValueOnce({ result: { ok: true }, summary: 'Checklist', plan: initial })
      .mockResolvedValueOnce({ result: { ok: true }, summary: 'Checklist', plan: updated })
      .mockResolvedValueOnce({ result: { ok: true }, summary: 'Compacted', contextSummary: 'Keep building the beat.' });
    const run = runAgent('Make a beat');
    await vi.waitFor(() => expect(mocks.stream).toHaveBeenCalledTimes(3));
    const cards = useAgent.getState().items.filter((i) => i.kind === 'plan');
    expect(cards).toHaveLength(1);
    expect(cards[0].steps).toEqual(updated);
    expect(useAgent.getState().running).toBe(true);
    expect(mocks.tool.mock.calls[1][2].plan).toEqual(initial);
    expect(mocks.tool.mock.calls[2][2].plan).toEqual(updated);
    const request = mocks.stream.mock.calls[2][0] as LlmRequest;
    expect(request.system).toContain('1. [done] Build drums');
    expect(request.system).toContain('2. [active] Balance bass');
    expect(useAgent.getState().items.some((i) => i.kind === 'tool' && i.name === 'update_plan')).toBe(false);
    final.resolve(answer());
    await run;
    // Ending a run never marks unfinished work complete automatically.
    expect(useAgent.getState().items.find((i) => i.id === cards[0].id)).toMatchObject({ steps: updated });
  });
});

describe('voice messages', () => {
  const voice = { wav: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]).buffer, seconds: 3.2, url: 'blob:voice' };
  const audioParts = (req: LlmRequest) => req.contents.flatMap((c) => c.parts).filter((p) => p.inlineData);

  it('sends the recording to the model on every turn of the run, but keeps it out of saved history', async () => {
    mocks.stream.mockResolvedValueOnce(calls()).mockResolvedValueOnce(answer());
    mocks.tool.mockResolvedValue({ result: { ok: true }, summary: 'Edited' });
    await runAgent('', { voice });
    expect(mocks.stream).toHaveBeenCalledTimes(2);
    for (const [req] of mocks.stream.mock.calls as Array<[LlmRequest]>) {
      expect(audioParts(req)).toEqual([{ inlineData: { mimeType: 'audio/wav', data: 'UklGRgECAwQ=' } }]);
      // The clip sits right before the message that refers to it.
      const msg = req.contents.find((c) => c.parts.some((p) => p.inlineData))!;
      expect(msg.parts[1].text).toContain('<voice_message>');
      // The internal tag id never reaches the model, which would otherwise look it up as a sample.
      expect(JSON.stringify(req.contents)).not.toContain('<voice_message id=');
    }
    const s = useAgent.getState();
    expect(s.items.find((i) => i.kind === 'user')).toMatchObject({ text: '', voice: { url: 'blob:voice', seconds: 3.2 } });
    expect(JSON.stringify(s.history)).not.toContain('inlineData');
    expect(JSON.stringify(s.history)).toContain('Earlier voice message');
  });

  it('does not resend an earlier run’s recording', async () => {
    mocks.stream.mockResolvedValue(answer());
    await runAgent('', { voice });
    await runAgent('Now make it faster');
    expect(audioParts(mocks.stream.mock.calls[1][0] as LlmRequest)).toHaveLength(0);
  });

  it('delivers spoken steering to the active run', async () => {
    const first = deferred<LlmResult>();
    mocks.stream.mockReturnValueOnce(first.promise).mockResolvedValueOnce(answer());
    const run = runAgent('Make a beat');
    expect(steerAgent('', { voice })).toBe(true);
    first.resolve(answer());
    await run;
    const second = mocks.stream.mock.calls[1][0] as LlmRequest;
    expect(audioParts(second)).toHaveLength(1);
    expect(JSON.stringify(second.contents)).toContain('Latest steering from the user, by voice');
  });
});

describe('reviewing agent changes', () => {
  it('gives Keep and Undo all a fresh version so other signed-in devices pick them up', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const checkpoint = useDaw.getState().project;
    useDaw.getState().update('AI', (d) => { d.tracks.push({ id: 't', name: 'Drums', kind: 'drums', color: '#fff', volumeDb: 0, pan: 0, mute: false, solo: false, effects: [], clips: [{ id: 'c', type: 'midi', start: 0, length: 4, notes: [], aiPending: true }] } as never); });
    vi.spyOn(Date, 'now').mockReturnValue(2000);
    keepChanges('none');
    expect(useDaw.getState().project.updatedAt).toBe(2000);
    expect(useDaw.getState().project.tracks[0].clips[0].aiPending).toBeUndefined();
    vi.spyOn(Date, 'now').mockReturnValue(3000);
    revertTo(checkpoint);
    expect(useDaw.getState().project.tracks).toHaveLength(0);
    expect(useDaw.getState().project.updatedAt).toBe(3000);
  });
});

describe('selection delivery to the producer', () => {
  it('keeps exact note context outside compactable history and passes it to tools', async () => {
    const { createMidiClip, createTrack } = await import('../model/project');
    const p = createProject(); const t = createTrack(p, 'drums'); const c = createMidiClip(p, 0, 8);
    c.notes = [{ id: 'selected-hit', pitch: 36, start: 1, duration: 0.25, velocity: 0.5 }, { id: 'other-hit', pitch: 36, start: 5, duration: 0.25, velocity: 0.9 }];
    t.clips.push(c); p.tracks.push(t); useDaw.getState().replaceProject(p);
    const selection = { clipIds: [c.id], notes: [{ clipId: c.id, noteIds: ['selected-hit'] }] };
    mocks.stream.mockResolvedValueOnce({ content: { role: 'model', parts: [{ functionCall: { name: 'edit', args: {} } }] } }).mockResolvedValueOnce(answer());
    mocks.tool.mockResolvedValueOnce({ result: { ok: true }, summary: 'Edited the selected phrase' });
    await runAgent('Improve this intro phrase', { focusSelection: selection });
    expect(mocks.stream.mock.calls[0][0].system).toContain('selected-hit:');
    expect(mocks.stream.mock.calls[1][0].system).toContain('selected-hit:');
    expect(mocks.stream.mock.calls[0][0].system).not.toContain('other-hit:');
    expect(mocks.tool.mock.calls[0][2].selection).toEqual(selection);
  });
});

describe('production review completion', () => {
  async function prepareSong() {
    const { createMidiClip, createTrack } = await import('../model/project');
    const p = createProject(); const t = createTrack(p, 'instrument', { preset: 'pad' });
    const c = createMidiClip(p, 0, 16);
    c.notes = [{ id: 'n1', pitch: 60, start: 0, duration: 4, velocity: 0.7 }];
    t.clips.push(c); p.tracks.push(t); useDaw.getState().replaceProject(p);
  }
  const call = (name: string, args = {}): LlmResult => ({ content: { role: 'model', parts: [{ functionCall: { name, args } }] } });
  const editVolume = async () => {
    useDaw.getState().update('Adjust level', (p) => { p.tracks[0].volumeDb -= 3; });
    return { result: { ok: true }, summary: 'Adjusted level' };
  };

  it('continues past premature completion and reviews the edited mix', async () => {
    await prepareSong(); mocks.listening = true;
    mocks.stream.mockResolvedValueOnce(call('update_track')).mockResolvedValueOnce(answer()).mockResolvedValueOnce(call('listen')).mockResolvedValueOnce(answer());
    mocks.tool.mockImplementationOnce(editVolume).mockResolvedValueOnce({ result: { heard: 'Balanced, no further fix needed.', bars: '1–5' }, summary: 'Listened' });
    await runAgent('Make the pad quieter');
    expect(mocks.stream).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(mocks.stream.mock.calls[2][0].contents)).toContain('Before finishing');
    expect(mocks.stream.mock.calls[3][0].system).toContain('Current mix reviewed: 1–5');
    expect(useAgent.getState().items.filter((item) => item.kind === 'error')).toEqual([]);
  });

  it('does not add a listening obligation when the user disabled it', async () => {
    await prepareSong();
    mocks.stream.mockResolvedValueOnce(call('update_track')).mockResolvedValueOnce(answer());
    mocks.tool.mockImplementationOnce(editVolume);
    await runAgent('Make the pad quieter');
    expect(mocks.stream).toHaveBeenCalledTimes(2);
    expect(mocks.stream.mock.calls[1][0].system).toContain('Listening is disabled');
  });

  it('bounds final-review retries and reports missing verification honestly', async () => {
    await prepareSong(); mocks.listening = true;
    mocks.stream.mockResolvedValueOnce(call('update_track')).mockResolvedValue(answer());
    mocks.tool.mockImplementationOnce(editVolume);
    await runAgent('Improve the mix');
    expect(mocks.stream).toHaveBeenCalledTimes(3);
    expect(useAgent.getState().items.some((item) => item.kind === 'error' && item.text.includes('listening review'))).toBe(true);
    expect(useDaw.getState().transaction).toBeNull();
  });
});
