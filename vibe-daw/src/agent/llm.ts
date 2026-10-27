import { useSettings, effectiveApiKey, type Thinking } from '../state/settings';
import { getFirebaseApp } from '../cloud/firebase';
import { hasAiConsent } from '../legal/acceptance';

function requireAiConsent() {
  if (!hasAiConsent()) throw new Error('Review the AI terms and data notice in Settings before using the agent.');
}

// Provider-neutral model client. Gemini parts are the wire format; three transports:
//  - 'apikey'   → @google/genai straight to the Gemini API (dev / bring-your-own-key)
//  - 'firebase' → Firebase AI Logic (production: no key in the bundle, App Check enforced)
//  - 'groq'     → Groq's OpenAI-style API with the user's own key (provider setting)
// Parts are passed through untouched so Gemini 3+ thought signatures survive the round trip.

export interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
  inlineData?: { mimeType: string; data: string };
}

export interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>;
}

export interface LlmRequest {
  system?: string;
  contents: Content[];
  tools?: ToolDeclaration[];
  thinking?: Thinking;
  signal?: AbortSignal;
  model?: string;
  temperature?: number;
  /** Ask for JSON output. */
  json?: boolean;
  maxOutputTokens?: number;
}

export interface StreamHandlers {
  onText?: (delta: string) => void;
  onThought?: (delta: string) => void;
}

export interface LlmResult {
  content: Content;
  usage?: { input?: number; output?: number; thoughts?: number };
  finishReason?: string;
}

interface RawChunk {
  candidates?: Array<{ content?: { parts?: Part[] }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

function collect(chunk: RawChunk, parts: Part[], h: StreamHandlers): string | undefined {
  const cand = chunk.candidates?.[0];
  for (const part of cand?.content?.parts ?? []) {
    parts.push(part);
    if (part.text) {
      if (part.thought) h.onThought?.(part.text);
      else h.onText?.(part.text);
    }
  }
  return cand?.finishReason;
}

/** Merge adjacent plain-text parts so history stays compact (never touches signed parts). */
function compact(parts: Part[]): Part[] {
  const out: Part[] = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    const plain = (x: Part) => x.text !== undefined && !x.thoughtSignature && !x.functionCall && Object.keys(x).every((k) => k === 'text' || k === 'thought');
    if (prev && plain(prev) && plain(p) && !!prev.thought === !!p.thought) {
      out[out.length - 1] = { ...prev, text: (prev.text ?? '') + (p.text ?? '') };
    } else if (!(p.text === '' && !p.thoughtSignature && !p.functionCall)) {
      out.push(p);
    }
  }
  return out;
}

// ---------------------------------------------------------------- direct (API key)

let genaiCache: { key: string; client: import('@google/genai').GoogleGenAI } | null = null;

export async function getGenAI() {
  requireAiConsent();
  const key = effectiveApiKey();
  if (!key) throw new Error('No Gemini API key. Add one in Settings.');
  if (genaiCache?.key === key) return genaiCache.client;
  const { GoogleGenAI } = await import('@google/genai');
  const client = new GoogleGenAI({ apiKey: key });
  genaiCache = { key, client };
  return client;
}

async function streamDirect(req: LlmRequest, h: StreamHandlers): Promise<LlmResult> {
  const ai = await getGenAI();
  const model = req.model ?? useSettings.getState().model;
  const stream = await ai.models.generateContentStream({
    model,
    contents: req.contents as never,
    config: {
      systemInstruction: req.system,
      tools: req.tools?.length ? [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, ...(t.parameters ? { parametersJsonSchema: t.parameters } : {}) })) }] : undefined,
      thinkingConfig: { includeThoughts: true, ...(req.thinking ? { thinkingLevel: req.thinking as never } : {}) },
      temperature: req.temperature,
      responseMimeType: req.json ? 'application/json' : undefined,
      maxOutputTokens: req.maxOutputTokens,
      abortSignal: req.signal,
    },
  });
  const parts: Part[] = [];
  let finishReason: string | undefined;
  let usage: LlmResult['usage'];
  for await (const chunk of stream) {
    if (req.signal?.aborted) break;
    finishReason = collect(chunk as RawChunk, parts, h) ?? finishReason;
    const u = (chunk as RawChunk).usageMetadata;
    if (u) usage = { input: u.promptTokenCount, output: u.candidatesTokenCount, thoughts: u.thoughtsTokenCount };
  }
  return { content: { role: 'model', parts: compact(parts) }, usage, finishReason };
}

// ---------------------------------------------------------------- Firebase AI Logic

async function streamFirebase(req: LlmRequest, h: StreamHandlers): Promise<LlmResult> {
  const app = await getFirebaseApp();
  if (!app) throw new Error('Firebase is not configured for this build.');
  const { getAI, getGenerativeModel, GoogleAIBackend } = await import('firebase/ai');
  const ai = getAI(app, { backend: new GoogleAIBackend() });
  const model = getGenerativeModel(ai, {
    model: req.model ?? useSettings.getState().model,
    systemInstruction: req.system,
    tools: req.tools?.length ? [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, ...(t.parameters ? { parameters: t.parameters as never } : {}) })) }] : undefined,
    generationConfig: {
      thinkingConfig: { includeThoughts: true, ...(req.thinking ? { thinkingLevel: req.thinking as never } : {}) },
      temperature: req.temperature,
      responseMimeType: req.json ? 'application/json' : undefined,
      maxOutputTokens: req.maxOutputTokens,
    },
  });
  const result = await model.generateContentStream({ contents: req.contents as never }, { signal: req.signal });
  const parts: Part[] = [];
  let finishReason: string | undefined;
  let usage: LlmResult['usage'];
  for await (const chunk of result.stream) {
    if (req.signal?.aborted) break;
    finishReason = collect(chunk as unknown as RawChunk, parts, h) ?? finishReason;
    const u = (chunk as unknown as RawChunk).usageMetadata;
    if (u) usage = { input: u.promptTokenCount, output: u.candidatesTokenCount, thoughts: u.thoughtsTokenCount };
  }
  return { content: { role: 'model', parts: compact(parts) }, usage, finishReason };
}

// ---------------------------------------------------------------- Groq (OpenAI-style API)
// Groq has no audio input: voice messages are transcribed with Whisper first, and the
// listening tools (ears.ts) refuse to run. Reasoning streams to onThought but is not kept
// in history, so switching back to Gemini mid-chat never sends it foreign thought parts.

const GROQ_API = 'https://api.groq.com/openai/v1';
const WHISPER_MODEL = 'whisper-large-v3-turbo';

type GroqMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

interface GroqChunk {
  choices?: Array<{
    delta?: { content?: string | null; reasoning?: string | null; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  x_groq?: { usage?: { prompt_tokens?: number; completion_tokens?: number } };
}

function groqKey(): string {
  const key = useSettings.getState().groqKey.trim();
  if (!key) throw new Error('No Groq API key. Add one in Settings.');
  return key;
}

async function groqError(res: Response): Promise<Error> {
  let detail = '';
  try { detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''; } catch { /* not JSON */ }
  return new Error(`Groq ${res.status}: ${detail || res.statusText}`);
}

// The agent resends a run's history every turn, so each voice clip is transcribed once.
const transcripts = new Map<string, string>();

async function transcribe(audio: NonNullable<Part['inlineData']>, signal?: AbortSignal): Promise<string> {
  const id = `${audio.data.length}:${audio.data.slice(0, 96)}:${audio.data.slice(-96)}`;
  const known = transcripts.get(id);
  if (known !== undefined) return known;
  const bytes = Uint8Array.from(atob(audio.data), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: audio.mimeType }), 'voice.wav');
  form.append('model', WHISPER_MODEL);
  const res = await fetch(`${GROQ_API}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${groqKey()}` }, body: form, signal });
  if (!res.ok) throw await groqError(res);
  const text = (((await res.json()) as { text?: string }).text ?? '').trim();
  transcripts.set(id, text);
  return text;
}

async function toGroqMessages(req: LlmRequest): Promise<GroqMessage[]> {
  const out: GroqMessage[] = [];
  if (req.system) out.push({ role: 'system', content: req.system });
  // Gemini calls may have no id: pair each response with the open call of the same name.
  let open: Array<{ id: string; name: string }> = [];
  let next = 0;
  for (const c of req.contents) {
    if (c.role === 'model') {
      const text = c.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
      const calls = c.parts.filter((p) => p.functionCall).map((p) => ({
        id: p.functionCall!.id ?? `call_${next++}`,
        type: 'function' as const,
        function: { name: p.functionCall!.name, arguments: JSON.stringify(p.functionCall!.args ?? {}) },
      }));
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      open = calls.map((t) => ({ id: t.id, name: t.function.name }));
      continue;
    }
    const texts: string[] = [];
    for (const p of c.parts) {
      if (p.functionResponse) {
        const r = p.functionResponse;
        const i = open.findIndex((t) => (r.id ? t.id === r.id : t.name === r.name));
        const id = i >= 0 ? open.splice(i, 1)[0].id : r.id ?? `call_${next++}`;
        out.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(r.response) });
      } else if (p.inlineData?.mimeType.startsWith('audio/')) {
        texts.push(`[Voice message, transcribed] ${await transcribe(p.inlineData, req.signal)}`);
      } else if (p.inlineData) {
        texts.push('(An attachment was left out: the Groq model in use cannot see it.)');
      } else if (p.text && !p.thought) {
        texts.push(p.text);
      }
    }
    if (texts.length) out.push({ role: 'user', content: texts.join('\n\n') });
  }
  return out;
}

const GROQ_EFFORT: Record<Thinking, 'low' | 'medium' | 'high'> = { MINIMAL: 'low', LOW: 'low', MEDIUM: 'medium', HIGH: 'high' };
const GROQ_FINISH: Record<string, string> = { stop: 'STOP', tool_calls: 'STOP', length: 'MAX_TOKENS', content_filter: 'SAFETY' };

async function streamGroq(req: LlmRequest, h: StreamHandlers): Promise<LlmResult> {
  // req.model names a Gemini model when callers pick one; on Groq the user's choice wins.
  const model = useSettings.getState().groqModel;
  const reasoning = model.startsWith('openai/gpt-oss')
    ? { reasoning_effort: GROQ_EFFORT[req.thinking ?? 'MEDIUM'], include_reasoning: true }
    : model.startsWith('qwen/') ? { reasoning_format: 'parsed' } : {};
  const res = await fetch(`${GROQ_API}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${groqKey()}`, 'Content-Type': 'application/json' },
    signal: req.signal,
    body: JSON.stringify({
      model,
      messages: await toGroqMessages(req),
      stream: true,
      stream_options: { include_usage: true },
      temperature: req.temperature,
      max_completion_tokens: req.maxOutputTokens,
      ...(req.tools?.length ? { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters ?? { type: 'object', properties: {} } } })) } : {}),
      ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      ...reasoning,
    }),
  });
  if (!res.ok || !res.body) throw await groqError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const calls: Array<{ id: string; name: string; args: string }> = [];
  let buffer = '', text = '', finishReason: string | undefined, usage: LlmResult['usage'];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      const chunk = JSON.parse(data) as GroqChunk;
      const choice = chunk.choices?.[0];
      const delta = choice?.delta;
      if (delta?.reasoning) h.onThought?.(delta.reasoning);
      if (delta?.content) { text += delta.content; h.onText?.(delta.content); }
      for (const tc of delta?.tool_calls ?? []) {
        const slot = (calls[tc.index] ??= { id: '', name: '', args: '' });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.args += tc.function.arguments;
      }
      if (choice?.finish_reason) finishReason = GROQ_FINISH[choice.finish_reason] ?? choice.finish_reason;
      const u = chunk.usage ?? chunk.x_groq?.usage;
      if (u) usage = { input: u.prompt_tokens, output: u.completion_tokens };
    }
  }

  const parts: Part[] = text ? [{ text }] : [];
  for (const c of calls.filter(Boolean)) {
    let args: Record<string, unknown> = {};
    try { args = c.args ? JSON.parse(c.args) : {}; } catch { finishReason = 'MALFORMED_FUNCTION_CALL'; }
    parts.push({ functionCall: { name: c.name, args, ...(c.id ? { id: c.id } : {}) } });
  }
  return { content: { role: 'model', parts }, usage, finishReason };
}

// ---------------------------------------------------------------- public

type Override = (req: LlmRequest, h: StreamHandlers) => Promise<LlmResult>;
let override: Override | null = null;
/** Test hook: route all model calls through a scripted function. */
export function setLlmOverride(fn: Override | null) {
  override = fn;
}

export async function streamGenerate(req: LlmRequest, h: StreamHandlers = {}): Promise<LlmResult> {
  if (override) return override(req, h);
  requireAiConsent();
  const { provider, connection } = useSettings.getState();
  const attempt = (r: LlmRequest) => (provider === 'groq' ? streamGroq(r, h) : connection === 'firebase' ? streamFirebase(r, h) : streamDirect(r, h));
  try {
    return await attempt(req);
  } catch (e) {
    if (req.signal?.aborted) throw e;
    const msg = String((e as Error)?.message ?? e);
    // Some models don't accept every thinking level - retry with the model's default.
    if (req.thinking && /thinking/i.test(msg) && /400|INVALID_ARGUMENT|not supported|invalid/i.test(msg)) {
      return attempt({ ...req, thinking: undefined });
    }
    // One retry on transient overload / network errors.
    if (/429|503|500|overloaded|UNAVAILABLE|fetch failed|network/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 2500));
      return attempt(req);
    }
    throw e;
  }
}

export async function generateText(req: LlmRequest): Promise<string> {
  const r = await streamGenerate(req);
  return r.content.parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
}

/** Turn API errors into something a producer can act on. */
export function explainError(e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if (/^Groq /.test(msg)) {
    if (/Groq 401|invalid.api.key/i.test(msg)) return 'That Groq API key was rejected. Check it in Settings.';
    if (/Groq 429|rate.limit/i.test(msg)) return 'Groq rate limit hit. Wait a moment, or pick a smaller Groq model in Settings.';
    if (/decommissioned|does not exist|model_not_found|Groq 404/i.test(msg)) return 'That Groq model isn’t available any more. Pick another one in Settings.';
    if (/tool|function/i.test(msg) && /Groq 400/.test(msg)) return 'This Groq model fumbled a tool call. Try again, or switch to GPT-OSS 120B in Settings.';
  }
  if (/API key not valid|API_KEY_INVALID|permission denied.*key/i.test(msg)) return 'That Gemini API key was rejected. Check it in Settings.';
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) return 'Gemini rate limit hit. Wait a moment, or switch to a lighter model in Settings.';
  if (/billing|Blaze/i.test(msg)) return 'This model needs a billing-enabled project (Firebase Blaze). Pick Gemini 3.8 Flash in Settings, or enable billing.';
  if (/not found|404/i.test(msg) && /model/i.test(msg)) return 'That model isn’t available to your key or project. Pick another model in Settings.';
  if (/aborted|AbortError/i.test(msg)) return 'Stopped.';
  if (/App Check|app-check/i.test(msg)) return 'Firebase App Check blocked the request. Check your reCAPTCHA site key and App Check settings.';
  return msg.length > 400 ? msg.slice(0, 400) + '…' : msg;
}
