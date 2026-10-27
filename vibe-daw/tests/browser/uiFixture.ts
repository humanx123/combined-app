import { useAgent } from '../../src/agent/agent';
import { getProject } from '../../src/state/store';
import { runTool } from '../../src/agent/tools';

/** Local UI fixture; uses no provider, credentials or persisted project edits. */
export function showReviewFixture() {
  useAgent.setState({ items: [
    { id: 'fixture-request', kind: 'user', text: 'Keep the melody, tighten the low end.', checkpoint: getProject() },
    { id: 'fixture-plan', kind: 'plan', steps: [{ title: 'Audition the chosen sounds', status: 'done' }, { title: 'Check the low end in context', status: 'active' }, { title: 'Review the finished arrangement', status: 'pending' }] },
    { id: 'fixture-review', kind: 'tool', name: 'listen', args: {}, status: 'done', summary: 'Listened to bars 1–2', heard: '- The bass is in tune and centered.\n- The guitar has room to breathe.\n- Shorten the kick tail slightly to give the bass more space.' },
    { id: 'fixture-sample', kind: 'tool', name: 'audition_samples', args: {}, status: 'done', summary: 'Listened to a kick sample', heard: 'Short, punchy kick with a clean low end.', sampleIds: ['b-kick-punchy'] },
    ...Array.from({ length: 15 }, (_, i) => ({ id: `fixture-${i}`, kind: 'assistant' as const, text: `Checked section ${i + 1}. Keeping the melody and reviewing the balance.`, thinking: '', streaming: false })),
  ] });
}

export async function advanceChecklistFixture() {
  const card = useAgent.getState().items.find((i) => i.id === 'fixture-plan');
  if (card?.kind !== 'plan') return;
  const out = await runTool('update_plan', { updates: [{ step: 2, status: 'done' }, { step: 3, status: 'active' }] }, { signal: new AbortController().signal, goal: 'Review the arrangement', plan: card.steps }, 'agent');
  if (out.plan) useAgent.setState((s) => ({ items: s.items.map((i) => i.id === card.id && i.kind === 'plan' ? { ...i, steps: out.plan! } : i) }));
}
