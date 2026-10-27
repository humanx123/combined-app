import type { Content, Part } from './llm';

// Audio never lives in history: ears calls are stateless, and voice messages are
// re-attached to each request of their run (see agent.ts).
// Compact whole exchanges: a signed function call and its response are indivisible.
export const CONTEXT_BUDGET = 64_000;
const TARGET = 40_000;
const SUMMARY_LIMIT = 8_000;
const SUMMARY_TAG = '<context_summary>';
const limit = (s: string, n: number) => s.length <= n ? s : s.slice(0, n) + ' [trimmed]';
export const historySize = (history: Content[]) => JSON.stringify(history).length;

export function summarizeHistory(history: Content[], supplied?: string): string {
  const objectives: string[] = [];
  const findings: string[] = [];
  for (const c of history) for (const p of c.parts) {
    if (p.text && !p.thought) {
      const text = p.text.replace(/<project_state>[\s\S]*?<\/project_state>/g, '').trim();
      if (text.startsWith(SUMMARY_TAG)) {
        const previous = text.replace(/<\/?context_summary>/g, '').trim();
        const [goals, notes] = previous.split('Notes, decisions and listening findings:\n');
        objectives.push(goals.replace(/^Goals and instructions:\n/, '').trim());
        if (notes) findings.push(notes);
      }
      else if (text) (c.role === 'user' ? objectives : findings).push(limit(text, c.role === 'user' ? 1600 : 700));
    }
    if (p.functionResponse) {
      const r = p.functionResponse;
      findings.push(`${r.name}: ${limit(JSON.stringify(r.response), 900)}`);
    }
  }
  // Keep the original goal and the most recent corrections, plus recent findings.
  const goals = limit(objectives[0] ?? '', 1800) + '\n' + objectives.slice(1).join('\n').slice(-1700);
  return limit(`Goals and instructions:\n${goals}\nNotes, decisions and listening findings:\n${supplied ? limit(supplied, 4000) : findings.join('\n').slice(-4000)}`, SUMMARY_LIMIT);
}

/** Supply one fresh snapshot; stale snapshots are removed even before compaction. */
export function withProjectState(history: Content[], snapshot: string): Content[] {
  const out = history.map((c) => ({ ...c, parts: c.parts.flatMap((p): Part[] => {
    if (!p.text || p.thoughtSignature) return [p];
    const text = p.text.replace(/<project_state>[\s\S]*?<\/project_state>/g, '').trim();
    return text ? [{ ...p, text }] : [];
  }) })).filter((c) => c.parts.length);
  const state: Part = { text: `<project_state>\n${limit(snapshot, 20_000)}\n</project_state>` };
  const last = out[out.length - 1];
  if (last?.role === 'user') out[out.length - 1] = { ...last, parts: [...last.parts, state] };
  else out.push({ role: 'user', parts: [state] });
  return out;
}

export function compactHistory(history: Content[], opts: { force?: boolean; summary?: string } = {}): { history: Content[]; chars: number; compacted: boolean } {
  const clean = history.map((c) => ({ ...c, parts: c.parts.flatMap((p): Part[] => {
    if (p.inlineData) return [{ text: '(Audio omitted; retain the listening findings.)' }];
    if (p.thought && !p.thoughtSignature) return [];
    if (p.functionResponse && JSON.stringify(p.functionResponse.response).length > 8000) return [{ ...p, functionResponse: { ...p.functionResponse, response: { truncated: true, summary: limit(JSON.stringify(p.functionResponse.response), 7000), note: 'Request a smaller range if you need more detail.' } } }];
    return [p]; // Signed parts are kept byte-for-byte while their exchange is retained.
  }) })).filter((c) => c.parts.length);
  const size = historySize(clean);
  if (!opts.force && size <= CONTEXT_BUDGET) return { history: clean, chars: size, compacted: false };
  let result = clean;
  for (let cut = 1; cut < clean.length - 1; cut++) {
    // Never leave an orphaned function response or remove an unanswered call.
    if (clean[cut].parts.some((p) => p.functionResponse) || clean[cut - 1].parts.some((p) => p.functionCall)) continue;
    const summary = summarizeHistory(clean.slice(0, cut), opts.summary);
    result = [{ role: 'user', parts: [{ text: `${SUMMARY_TAG}\n${summary}\n</context_summary>` }] }, ...clean.slice(cut)];
    if (historySize(result) <= TARGET && (!opts.force || cut >= clean.length - 4)) break;
  }
  const chars = historySize(result);
  // A single huge signed exchange cannot safely be shortened. Fail explicitly
  // instead of silently exceeding the budget or corrupting provider signatures.
  if (chars > CONTEXT_BUDGET) throw new Error('The latest tool exchange exceeds the context budget. Ask for a smaller range of bars or notes, then continue.');
  return { history: result, chars, compacted: result !== clean };
}
