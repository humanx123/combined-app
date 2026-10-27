import { create } from 'zustand';
import {haptic} from '../native/native-haptics';
import { produce } from 'immer';
import type { Project } from '../model/types';
import { beatToBar } from '../model/project';
import { getProject, useDaw } from '../state/store';
import { useSettings, aiAvailable } from '../state/settings';
import { streamGenerate, explainError, type Content, type Part } from './llm';
import { describeProject, describeClipNotes, describeSelection } from './context';
import type { EditSelection } from '../model/selection';
import { systemPrompt } from './prompts';
import { runTool, toolDeclarations, type AgentMode, type PlanStep } from './tools';
import { diffProjects } from './diff';
import { findClip } from '../model/project';
import { compactHistory, CONTEXT_BUDGET, historySize, summarizeHistory, withProjectState } from './history';
import { arrayBufferToBase64 } from '../engine/wav';
import { ProductionReview } from './productionReview';
import { productionSkills } from './skills';

// The agent loop: stream a turn, run whatever tools the model calls, feed results
// back, repeat until it answers in plain text. All edits land in one undo step and
// get a reviewable change summary - Cursor's accept/reject, for music.

const MAX_TURNS = 48;

export type ChatItem =
  | { kind: 'user'; id: string; text: string; checkpoint: Project; focus?: string; steering?: 'queued' | 'applied' | 'cancelled'; voice?: { url: string; seconds: number } }
  | { kind: 'assistant'; id: string; text: string; thinking: string; streaming: boolean }
  | { kind: 'tool'; id: string; name: string; args: Record<string, unknown>; status: 'running' | 'done' | 'error'; summary: string; heard?: string; sampleIds?: string[]; clipIds?: string[] }
  | { kind: 'plan'; id: string; steps: PlanStep[] }
  | { kind: 'changes'; id: string; lines: string[]; checkpoint: Project; state: 'pending' | 'kept' | 'reverted' }
  | { kind: 'error'; id: string; text: string };

interface AgentState {
  items: ChatItem[];
  history: Content[];
  running: boolean;
  mode: AgentMode;
  status: string;
  abort: AbortController | null;
  tokens: { input: number; output: number };
  steering: Array<{ id: string; text: string; opts: RunOptions; voiceTag?: string }>;
  context: { chars: number; compactions: number };
  setMode: (m: AgentMode) => void;
  clear: () => void;
}

export const useAgent = create<AgentState>((set) => ({
  items: [],
  history: [],
  running: false,
  mode: 'agent',
  status: '',
  abort: null,
  tokens: { input: 0, output: 0 },
  steering: [],
  context: { chars: 0, compactions: 0 },
  setMode: (mode) => set({ mode }),
  clear: () => {
    useAgent.getState().abort?.abort();
    useDaw.getState().endTransaction();
    set({ items: [], history: [], tokens: { input: 0, output: 0 }, steering: [], context: { chars: 0, compactions: 0 }, running: false, abort: null, status: '' });
  },
}));

let seq = 0;
const nid = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

function push(item: ChatItem) {
  useAgent.setState((s) => ({ items: [...s.items, item] }));
}

function patch(id: string, fn: (it: ChatItem) => ChatItem) {
  useAgent.setState((s) => ({ items: s.items.map((it) => (it.id === id ? fn(it) : it)) }));
}

function setStatus(status: string) {
  useAgent.setState({ status });
}

export interface RunOptions {
  /** Restrict attention to these clips (inline Ctrl+K edits). */
  focusClipIds?: string[];
  focusSelection?: EditSelection;
  /** Extra context, e.g. a reference-track breakdown. */
  attachments?: string[];
  mode?: AgentMode;
  /** A spoken message (16 kHz mono WAV) the model hears directly. */
  voice?: { wav: ArrayBuffer; seconds: number; url: string };
}

// Voice messages ride beside the history instead of inside it: history is size-budgeted
// and strips audio when compacted. Each request of the run re-attaches the clip to the
// message that carries its tag; when the run ends the tag becomes a short note.
const runVoices = new Map<string, Part>();
const VOICE_TAG = /<voice_message id="([^"]+)">[\s\S]*?<\/voice_message>/g;

function registerVoice(voice: NonNullable<RunOptions['voice']>): string {
  const id = `v${nid()}`;
  runVoices.set(id, { inlineData: { mimeType: 'audio/wav', data: arrayBufferToBase64(voice.wav) } });
  return `<voice_message id="${id}">The user spoke this message (${Math.round(voice.seconds)} s recording attached just before this text). Listen to it: it is their request, in their own words and tone. The recording is already here; it is not a sample or track, so do not search for it or audition it with tools. If they hum or sing a tune, treat it as the melody or rhythm they want.</voice_message>`;
}

// The tag id is bookkeeping only: the model never sees it, or it mistakes it for a sample
// or track id and goes looking for it with tools.
const hideVoiceIds = (p: Part): Part => (p.text && !p.thoughtSignature && p.text.includes('<voice_message id=') ? { ...p, text: p.text.replace(/<voice_message id="[^"]+">/g, '<voice_message>') } : p);

function withVoices(history: Content[]): Content[] {
  return history.map((c) => {
    const audio = c.parts.flatMap((p) => [...(p.text?.matchAll(VOICE_TAG) ?? [])].map((m) => runVoices.get(m[1])).filter((a): a is Part => !!a));
    const parts = c.parts.map(hideVoiceIds);
    return { ...c, parts: audio.length ? [...audio, ...parts] : parts };
  });
}

function retireVoices(history: Content[]): Content[] {
  runVoices.clear();
  return history.map((c) => ({ ...c, parts: c.parts.map((p) => (p.text && !p.thoughtSignature && p.text.includes('<voice_message') ? { ...p, text: p.text.replace(VOICE_TAG, '<voice_message>(Earlier voice message from the user; the audio is no longer attached. Your replies above reflect what they asked.)</voice_message>') } : p)) }));
}

function focusContext(p: Project, clipIds: string[]): { text: string; label: string } {
  const parts: string[] = [];
  const names: string[] = [];
  for (const id of clipIds) {
    const f = findClip(p, id);
    if (!f) continue;
    names.push(`“${f.clip.name}” on ${f.track.name}`);
    if (f.clip.type === 'midi') parts.push(describeClipNotes(p, f.track, f.clip));
    else parts.push(`${f.clip.id} audio clip "${f.clip.name}" on ${f.track.id} "${f.track.name}", bars ${beatToBar(p, f.clip.start)}–${beatToBar(p, f.clip.start + f.clip.length)}`);
  }
  return {
    text: `<selection>\nThe user selected these clips. Apply the request to them (edit in place; keep their position unless asked) and leave the rest of the song alone unless the request clearly needs it.\n${parts.join('\n\n')}\n</selection>`,
    label: names.join(', '),
  };
}

/** Follow-ups stay in this run and its undo transaction. */
export function steerAgent(text: string, opts: RunOptions = {}): boolean {
  const s = useAgent.getState();
  if (!s.running || s.abort?.signal.aborted || (!text.trim() && !opts.voice)) return false;
  const id = nid();
  const p = getProject();
  const focus = opts.focusSelection ? describeSelection(p, opts.focusSelection) : opts.focusClipIds?.length ? focusContext(p, opts.focusClipIds) : null;
  const voiceTag = opts.voice ? registerVoice(opts.voice) : undefined;
  const voice = opts.voice ? { url: opts.voice.url, seconds: opts.voice.seconds } : undefined;
  useAgent.setState((state) => ({
    items: [...state.items, { kind: 'user', id, text: text.trim(), checkpoint: p, focus: focus?.label, steering: 'queued', voice }],
    steering: [...state.steering, { id, text: text.trim(), opts, voiceTag }],
  }));
  return true;
}

export async function runAgent(text: string, opts: RunOptions = {}) {
  const st = useAgent.getState();
  if (!text.trim() && !opts.voice) return;
  if (st.running) { steerAgent(text, opts); return; }
  const avail = aiAvailable();
  if (!avail.ok) {
    push({ kind: 'error', id: nid(), text: avail.reason! });
    window.dispatchEvent(new Event('vibe:open-settings'));
    return;
  }
  const mode = opts.mode ?? st.mode;
  const abort = new AbortController();
  const checkpoint = getProject();
  const focus = opts.focusSelection ? describeSelection(checkpoint, opts.focusSelection) : opts.focusClipIds?.length ? focusContext(checkpoint, opts.focusClipIds) : null;
  push({ kind: 'user', id: nid(), text: text.trim(), checkpoint, focus: focus?.label, voice: opts.voice ? { url: opts.voice.url, seconds: opts.voice.seconds } : undefined });
  useAgent.setState({ running: true, abort, status: opts.voice ? 'Listening…' : 'Thinking…' });
  const daw = useDaw.getState();
  if (mode === 'agent') daw.beginTransaction(`Agent: ${(text.trim() || 'voice message').slice(0, 48)}`);
  runVoices.clear();
  const voiceTag = opts.voice ? registerVoice(opts.voice) : '';

  const userParts: Part[] = [{
    text: [
      text.trim(),
      voiceTag,
      ...(opts.attachments ?? []),
      focus?.text ?? '',
      `<project_state>\n${describeProject(checkpoint)}\n</project_state>`,
    ].filter(Boolean).join('\n\n'),
  }];
  let history: Content[] = [...useAgent.getState().history, { role: 'user', parts: userParts }];
  const settings = useSettings.getState();
  const tools = toolDeclarations(mode);
  const review = new ProductionReview(checkpoint);
  const canListen = tools.some((tool) => tool.name === 'listen');
  const system = systemPrompt(mode) + '\n\nUse manage_context to inspect the context budget or compact your working memory with a concise summary of goals, steering, decisions, useful sample/track ids, listening findings and unfinished work. Automatic compaction also runs when needed. Latest steering supersedes conflicting earlier instructions; skipped tool calls were not executed.';
  let planId: string | null = null;
  let plan: PlanStep[] = [];
  let malformedRetries = 0;
  // Small open models (Groq, the free host) garble a tool call more often than Gemini: allow a few nudges.
  const malformedLimit = useSettings.getState().provider === 'gemini' ? 1 : 3;
  let completed = false;
  const baseGoal = text.trim() ? text : 'The user asked by voice (see the voice message in the conversation).';
  let goal = baseGoal;
  let requestedSummary: string | undefined;
  const active = () => useAgent.getState().abort === abort && getProject().id === checkpoint.id;
  const checkActive = () => { if (!active() || abort.signal.aborted) throw new DOMException('Aborted', 'AbortError'); };
  let activeSelection = opts.focusSelection;
  const applySteering = () => {
    const queued = useAgent.getState().steering;
    if (!queued.length) return;
    const parts: Part[] = queued.map((q) => ({ text: [
      q.text ? `Latest steering from the user: ${q.text}` : 'Latest steering from the user, by voice:',
      q.voiceTag ?? '',
      ...(q.opts.attachments ?? []),
      q.opts.focusSelection ? describeSelection(getProject(), q.opts.focusSelection).text : q.opts.focusClipIds?.length ? focusContext(getProject(), q.opts.focusClipIds).text : '',
    ].filter(Boolean).join('\n') }));
    const last = history[history.length - 1];
    if (last?.role === 'user') history = [...history.slice(0, -1), { ...last, parts: [...last.parts, ...parts] }];
    else history = [...history, { role: 'user', parts }];
    goal = `${baseGoal}\nSteering:\n${(goal.slice(baseGoal.length) + '\n' + queued.map((q) => q.text || '(voice message)').join('\n')).slice(-8000)}`;
    for (const q of queued) if (q.opts.focusSelection) activeSelection = q.opts.focusSelection;
    const ids = new Set(queued.map((q) => q.id));
    useAgent.setState((s) => ({ steering: [], items: s.items.map((i) => i.kind === 'user' && ids.has(i.id) ? { ...i, steering: 'applied' } : i) }));
  };

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      checkActive();
      applySteering();
      const compacted = compactHistory(withProjectState(history, describeProject(getProject())), { force: requestedSummary !== undefined, summary: requestedSummary });
      requestedSummary = undefined;
      history = compacted.history;
      useAgent.setState((s) => ({ context: { chars: compacted.chars, compactions: s.context.compactions + Number(compacted.compacted) } }));
      const aid = nid();
      push({ kind: 'assistant', id: aid, text: '', thinking: '', streaming: true });
      setStatus(turn === 0 ? 'Thinking…' : 'Working…');
      const res = await streamGenerate(
        // Keep the live checklist outside compacted history so progress is never
        // lost when old tool exchanges are summarized.
        { system: system + (activeSelection ? `\n\n${describeSelection(getProject(), activeSelection).text}` : '') + `\n\n${productionSkills(goal, !!activeSelection)}\n\n<checklist_state>\n${plan.length ? plan.map((s, i) => `${i + 1}. [${s.status}] ${s.title}`).join('\n') : 'No checklist yet for this run.'}\n</checklist_state>\n\n${review.context(getProject(), canListen)}`, contents: withVoices(history), tools, thinking: settings.thinking, signal: abort.signal },
        {
          onText: (d) => { if (active()) patch(aid, (it) => (it.kind === 'assistant' ? { ...it, text: it.text + d } : it)); },
          onThought: (d) => { if (active()) patch(aid, (it) => (it.kind === 'assistant' ? { ...it, thinking: it.thinking + d } : it)); },
          onWait: (sec) => { if (active()) setStatus(`Free model: one reply every ~30 s. Waiting ${sec} s…`); },
        },
      );
      checkActive();
      patch(aid, (it) => (it.kind === 'assistant' ? { ...it, streaming: false } : it));
      useAgent.setState((s) => ({ tokens: { input: s.tokens.input + (res.usage?.input ?? 0), output: s.tokens.output + (res.usage?.output ?? 0) } }));
      // Drop empty assistant bubbles (turns that were only tool calls).
      const item = useAgent.getState().items.find((x) => x.id === aid);
      if (item && item.kind === 'assistant' && !item.text.trim() && !item.thinking.trim()) {
        useAgent.setState((s) => ({ items: s.items.filter((x) => x.id !== aid) }));
      }
      if (!res.content.parts.length) {
        if (useAgent.getState().steering.length) continue;
        if (res.finishReason === 'MALFORMED_FUNCTION_CALL' && malformedRetries < malformedLimit) {
          // Nudge once instead of failing the whole run.
          malformedRetries++;
          const nudge: Part = { text: 'Your last tool call was malformed. Call the tool again with valid JSON arguments that match its schema.' };
          const last = history[history.length - 1];
          history = last?.role === 'user' ? [...history.slice(0, -1), { ...last, parts: [...last.parts, nudge] }] : [...history, { role: 'user', parts: [nudge] }];
          continue;
        }
        if (res.finishReason && res.finishReason !== 'STOP') throw new Error(`The model stopped early (${res.finishReason}).`);
        break;
      }
      if (res.finishReason && res.finishReason !== 'STOP') throw new Error(`The model stopped early (${res.finishReason}). Continue to finish the work; the partial response was not treated as completion.`);
      history = [...history, res.content];
      const calls = res.content.parts.filter((p) => p.functionCall).map((p) => p.functionCall!);
      if (!calls.length) {
        if (useAgent.getState().steering.length) continue;
        const reminder = mode === 'agent' ? review.completionReminder(getProject(), canListen) : null;
        if (reminder) {
          // Do not leave a premature "Done" bubble above the actual review.
          useAgent.setState((s) => ({ items: s.items.filter((item) => item.id !== aid) }));
          history = [...history, { role: 'user', parts: [{ text: reminder }] }];
          continue;
        }
        if (mode === 'agent' && canListen && review.needsReview(getProject())) push({ kind: 'error', id: nid(), text: 'Audio edits were made, but a listening review of the current full mix was not completed.' });
        completed = true;
        break;
      }

      const responses: Part[] = [];
      for (const call of calls) {
        checkActive();
        if (useAgent.getState().steering.length) {
          responses.push({ functionResponse: { name: call.name, response: { error: 'Skipped because the user supplied new steering. Re-plan before making more changes.' }, ...(call.id ? { id: call.id } : {}) } });
          continue;
        }
        const tid = nid();
        push({ kind: 'tool', id: tid, name: call.name, args: call.args ?? {}, status: 'running', summary: '' });
        setStatus(statusFor(call.name));
        const beforeTool = getProject();
        const out = await runTool(call.name, call.args ?? {}, { signal: abort.signal, goal, plan, selection: activeSelection, context: { chars: historySize(history), budget: CONTEXT_BUDGET } }, mode);
        checkActive();
        if (out.contextSummary !== undefined) requestedSummary = out.contextSummary;
        const failed = 'error' in out.result;
        if (call.name === 'listen' && !failed) review.record(beforeTool, call.args ?? {}, out.result);
        patch(tid, (it) => (it.kind === 'tool' ? { ...it, status: failed ? 'error' : 'done', summary: out.summary, heard: out.heard, sampleIds: out.sampleIds, clipIds: out.clipIds } : it));
        if (out.plan && !failed) {
          plan = out.plan;
          if (planId) patch(planId, (it) => (it.kind === 'plan' ? { ...it, steps: out.plan! } : it));
          else { planId = nid(); push({ kind: 'plan', id: planId, steps: out.plan }); }
          // The plan card replaces the tool row.
          useAgent.setState((s) => ({ items: s.items.filter((x) => x.id !== tid) }));
        }
        responses.push({ functionResponse: { name: call.name, response: out.result, ...(call.id ? { id: call.id } : {}) } });
      }
      history = [...history, { role: 'user', parts: responses }];
      if (turn === MAX_TURNS - 1) push({ kind: 'error', id: nid(), text: 'Stopped after many steps. Say “continue” to keep going.' });
    }
  } catch (e) {
    if (!active()) return;
    const aborted = abort.signal.aborted || (e as Error)?.name === 'AbortError';
    push({ kind: 'error', id: nid(), text: aborted ? 'Stopped.' : explainError(e) });
    // Close any dangling function calls so the next turn is valid.
    const last = history[history.length - 1];
    if (last?.role === 'model' && last.parts.some((p) => p.functionCall)) {
      history = [...history, { role: 'user', parts: last.parts.filter((p) => p.functionCall).map((p) => ({ functionResponse: { name: p.functionCall!.name, response: { error: aborted ? 'Stopped by user' : 'Failed' }, ...(p.functionCall!.id ? { id: p.functionCall!.id } : {}) } })) }];
    }
  } finally {
    if (active()) {
    if(completed && !abort.signal.aborted)haptic('message-complete');
    // Also bound persisted conversation memory when this run finishes or stops.
    history = retireVoices(history);
    try { history = compactHistory(history).history; } catch { history = [{ role: 'user', parts: [{ text: `<context_summary>\n${summarizeHistory(history)}\n</context_summary>` }] }]; }
    useAgent.setState((s) => ({
      running: false,
      abort: null,
      status: '',
      history,
      steering: [],
      items: s.items.map((it) => (it.kind === 'user' && it.steering === 'queued' ? { ...it, steering: 'cancelled' } : it.kind === 'tool' && it.status === 'running' ? { ...it, status: 'error', summary: it.summary || 'Interrupted' } : it.kind === 'assistant' && it.streaming ? { ...it, streaming: false } : it)),
    }));
    if (mode === 'agent') {
      useDaw.getState().endTransaction();
      const after = getProject();
      const diff = diffProjects(checkpoint, after);
      if (diff.lines.length) push({ kind: 'changes', id: nid(), lines: diff.lines, checkpoint, state: 'pending' });
    }
    }
  }
}

function statusFor(tool: string): string {
  switch (tool) {
    case 'listen': return 'Listening to the mix…';
    case 'audition_samples': return 'Auditioning samples…';
    case 'design_sound': return 'Designing a sound…';
    case 'bounce_to_sample': return 'Bouncing audio…';
    case 'write_drums': return 'Programming drums…';
    case 'write_notes': return 'Writing notes…';
    case 'search_samples': return 'Digging through samples…';
    default: return 'Working…';
  }
}

export function stopAgent() {
  useAgent.getState().abort?.abort();
}

/** Accept: clear the "unreviewed" highlight on AI-made clips. */
export function keepChanges(itemId: string) {
  useDaw.setState((s) => {
    const next = produce(s.project, (d) => { for (const t of d.tracks) for (const c of t.clips) if (c.aiPending) delete c.aiPending; for (const a of d.annotations ?? []) delete a.aiPending; });
    // A new version, so other signed-in devices pick up the acceptance too.
    return { project: next === s.project ? next : { ...next, updatedAt: Date.now() } };
  });
  patch(itemId, (it) => (it.kind === 'changes' ? { ...it, state: 'kept' } : it));
}

/** Reject: restore the project to how it was before that agent run (undoable). */
export function revertTo(checkpoint: Project, itemId?: string) {
  stopAgent();
  // Restamp: the restored checkpoint must win over copies of the rejected run on other devices.
  useDaw.getState().replaceProject({ ...checkpoint, updatedAt: Date.now() }, { keepHistory: true, label: 'Revert agent changes' });
  if (itemId) patch(itemId, (it) => (it.kind === 'changes' ? { ...it, state: 'reverted' } : it));
}

export function keepAllPending() {
  const items = useAgent.getState().items.filter((i) => i.kind === 'changes' && i.state === 'pending');
  for (const i of items) keepChanges(i.id);
}
