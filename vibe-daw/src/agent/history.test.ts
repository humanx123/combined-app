import { describe, expect, it } from 'vitest';
import { compactHistory, CONTEXT_BUDGET, withProjectState } from './history';
import type { Content } from './llm';

function conversation(count: number): Content[] {
  const h: Content[] = [{ role: 'user', parts: [{ text: 'Make a melancholic guitar beat. Keep the vocals untouched.' }] }];
  for (let i = 0; i < count; i++) h.push(
    { role: 'model', parts: [{ thoughtSignature: `signed-${i}`, functionCall: { name: 'listen', id: String(i), args: { start_bar: i + 1 } } }] },
    { role: 'user', parts: [{ functionResponse: { name: 'listen', id: String(i), response: { heard: 'Less mud, keep guitar. '.repeat(80), measured: '-12dB' } } }] },
  );
  return h;
}

describe('automatic context compaction', () => {
  it('bounds repeated listening history and preserves complete signed exchanges', () => {
    const h = conversation(100);
    h[h.length - 1].parts.push({ text: 'Latest steering: no extra drums.' });
    const result = compactHistory(h);
    expect(result.compacted).toBe(true);
    expect(result.chars).toBeLessThanOrEqual(CONTEXT_BUDGET);
    const text = JSON.stringify(result.history);
    expect(text).toContain('melancholic guitar');
    expect(text).toContain('no extra drums');
    expect(result.history.flatMap((c) => c.parts)).toContain(h[h.length - 2].parts[0]);
    for (let i = 0; i < result.history.length; i++) {
      const call = result.history[i].parts.find((p) => p.functionCall);
      if (call) expect(result.history[i + 1].parts.some((p) => p.functionResponse?.id === call.functionCall?.id)).toBe(true);
    }
  });
  it('never retains audio payloads or unsigned thought text', () => {
    const result = compactHistory([{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: 'a'.repeat(100000) } }, { text: 'Keep it dark' }] }, { role: 'model', parts: [{ text: 'private thought', thought: true }, { text: 'Okay' }] }]);
    expect(JSON.stringify(result.history)).not.toContain('inlineData');
    expect(JSON.stringify(result.history)).not.toContain('private thought');
    expect(result.chars).toBeLessThan(500);
  });
  it('keeps the original goal across repeated compactions and accepts an agent summary', () => {
    let h = compactHistory(conversation(80)).history;
    h = compactHistory([...h, ...conversation(70).slice(1)], { force: true, summary: 'Keep sample s-42. Next: fix the bass at bar 16.' }).history;
    const text = JSON.stringify(h);
    expect(text).toContain('melancholic guitar');
    expect(text).toContain('s-42');
  });
  it('refreshes project state instead of duplicating stale snapshots', () => {
    const h = withProjectState([{ role: 'user', parts: [{ text: 'Goal\n<project_state>old</project_state>' }] }], 'new');
    const again = withProjectState(h, 'newest');
    expect(JSON.stringify(again)).not.toContain('old');
    expect(JSON.stringify(again).match(/<project_state>/g)).toHaveLength(1);
    expect(JSON.stringify(again)).toContain('newest');
  });
});
