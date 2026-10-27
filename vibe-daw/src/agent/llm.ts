import { useSettings, effectiveApiKey, type Thinking } from '../state/settings';
import { getFirebaseApp } from '../cloud/firebase';
import { hasAiConsent } from '../legal/acceptance';

function requireAiConsent() {
  if (!hasAiConsent()) throw new Error('Review the AI terms and data notice in Settings before using the agent.');
}

// Provider-neutral Gemini client. Two transports, one wire format:
//  - 'apikey'   → @google/genai straight to the Gemini API (dev / bring-your-own-key)
//  - 'firebase' → Firebase AI Logic (production: no key in the bundle, App Check enforced)
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
  const connection = useSettings.getState().connection;
  const attempt = (r: LlmRequest) => (connection === 'firebase' ? streamFirebase(r, h) : streamDirect(r, h));
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
  if (/API key not valid|API_KEY_INVALID|permission denied.*key/i.test(msg)) return 'That Gemini API key was rejected. Check it in Settings.';
  if (/429|quota|RESOURCE_EXHAUSTED/i.test(msg)) return 'Gemini rate limit hit. Wait a moment, or switch to a lighter model in Settings.';
  if (/billing|Blaze/i.test(msg)) return 'This model needs a billing-enabled project (Firebase Blaze). Pick Gemini 3.8 Flash in Settings, or enable billing.';
  if (/not found|404/i.test(msg) && /model/i.test(msg)) return 'That model isn’t available to your key or project. Pick another model in Settings.';
  if (/aborted|AbortError/i.test(msg)) return 'Stopped.';
  if (/App Check|app-check/i.test(msg)) return 'Firebase App Check blocked the request. Check your reCAPTCHA site key and App Check settings.';
  return msg.length > 400 ? msg.slice(0, 400) + '…' : msg;
}
