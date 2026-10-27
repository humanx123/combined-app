import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => {
  const cache = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => cache.get(k) ?? null, setItem: (k: string, v: string) => cache.set(k, v), removeItem: (k: string) => cache.delete(k) } });
  return cache;
});
vi.mock('../cloud/firebase', () => ({ getFirebaseApp: async () => null }));

import { streamGenerate, explainError, parseToolArgs, type Content } from './llm';
import { useSettings } from '../state/settings';
import { acknowledgeAi } from '../legal/acceptance';
import { listen } from './ears';

/** A Groq-style server-sent event stream, split mid-line to exercise buffering. */
function sse(chunks: unknown[]): Response {
  const text = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n';
  const bytes = new TextEncoder().encode(text);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 37) controller.enqueue(bytes.slice(i, i + 37));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

const fetchMock = vi.fn();
beforeEach(() => {
  store.clear();
  acknowledgeAi(true);
  useSettings.getState().set({ provider: 'groq', groqKey: 'gsk_test', groqModel: 'openai/gpt-oss-120b', thinking: 'HIGH' });
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('Groq transport', () => {
  it('pairs Gemini-style tool calls with their responses and streams text, reasoning and calls back', async () => {
    fetchMock.mockResolvedValueOnce(sse([
      { choices: [{ delta: { reasoning: 'Thinking about drums. ' } }] },
      { choices: [{ delta: { content: 'Adding ' } }] },
      { choices: [{ delta: { content: 'a beat.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_x', function: { name: 'add_track', arguments: '{"name":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Drums"}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 120, completion_tokens: 30 } },
    ]));
    const contents: Content[] = [
      { role: 'user', parts: [{ text: 'Make a beat' }] },
      { role: 'model', parts: [{ text: 'On it.' }, { thoughtSignature: 'sig', functionCall: { name: 'plan', args: { steps: 2 } } }, { functionCall: { name: 'tempo', args: { bpm: 90 } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'tempo', response: { ok: true } } }, { functionResponse: { name: 'plan', response: { ok: 'planned' } } }, { text: 'Make it dusty' }] },
    ];
    const thoughts: string[] = [], texts: string[] = [];
    const res = await streamGenerate(
      { system: 'Producer', contents, tools: [{ name: 'add_track', description: 'Add a track', parameters: { type: 'object', properties: { name: { type: 'string' } } } }], thinking: 'HIGH' },
      { onThought: (t) => thoughts.push(t), onText: (t) => texts.push(t) },
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer gsk_test');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('openai/gpt-oss-120b');
    expect(body.reasoning_effort).toBe('high');
    expect(body.tools[0].function.name).toBe('add_track');
    expect(body.messages.map((m: { role: string }) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'tool', 'user']);
    const assistant = body.messages[2];
    expect(assistant.content).toBe('On it.');
    const [planId, tempoId] = assistant.tool_calls.map((t: { id: string }) => t.id);
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: tempoId, content: '{"ok":true}' });
    expect(body.messages[4]).toEqual({ role: 'tool', tool_call_id: planId, content: '{"ok":"planned"}' });
    expect(body.messages[5]).toEqual({ role: 'user', content: 'Make it dusty' });

    expect(thoughts.join('')).toBe('Thinking about drums. ');
    expect(texts.join('')).toBe('Adding a beat.');
    expect(res.finishReason).toBe('STOP');
    expect(res.usage).toEqual({ input: 120, output: 30 });
    expect(res.content.parts).toEqual([{ text: 'Adding a beat.' }, { functionCall: { name: 'add_track', args: { name: 'Drums' }, id: 'call_x' } }]);
  });

  it('transcribes voice messages once with Whisper instead of sending audio', async () => {
    fetchMock.mockImplementation(async (url: string) => (url.endsWith('/audio/transcriptions')
      ? new Response(JSON.stringify({ text: 'add some piano' }), { status: 200 })
      : sse([{ choices: [{ delta: { content: 'Sure.' }, finish_reason: 'stop' }] }])));
    const contents: Content[] = [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: btoa('RIFF-fake-wav') } }, { text: 'thanks' }] }];
    await streamGenerate({ contents });
    await streamGenerate({ contents });
    const transcriptions = fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/audio/transcriptions'));
    expect(transcriptions).toHaveLength(1);
    const chat = JSON.parse(fetchMock.mock.calls.find(([u]) => String(u).endsWith('/chat/completions'))![1].body);
    expect(chat.messages).toEqual([{ role: 'user', content: '[Voice message, transcribed] add some piano\n\nthanks' }]);
  });

  it('returns an unreadable tool call empty, the way the agent expects to retry it', async () => {
    fetchMock.mockResolvedValueOnce(sse([{ choices: [{ delta: { content: 'Writing drums.', tool_calls: [{ index: 0, id: 'c1', function: { name: 'edit', arguments: '{"bars": [1,' } }] }, finish_reason: 'tool_calls' }] }]));
    const res = await streamGenerate({ contents: [{ role: 'user', parts: [{ text: 'go' }] }] });
    expect(res.finishReason).toBe('MALFORMED_FUNCTION_CALL');
    expect(res.content.parts).toEqual([]);
  });

  it('recovers tool arguments wrapped in a fence or followed by stray text', () => {
    expect(parseToolArgs('{"bpm": 150}')).toEqual({ bpm: 150 });
    expect(parseToolArgs('```json\n{"steps": "x...", "note": "{not a brace}"}\n```')).toEqual({ steps: 'x...', note: '{not a brace}' });
    expect(parseToolArgs('{"bpm": 150} and then some words')).toEqual({ bpm: 150 });
    expect(parseToolArgs('')).toEqual({});
    expect(parseToolArgs('[1,2]')).toBeNull();
    expect(parseToolArgs('{"bars": [1,')).toBeNull();
  });

  it('explains Groq failures in producer terms', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 }));
    const err = await streamGenerate({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }).catch((e) => e);
    expect(explainError(err)).toBe('That Groq API key was rejected. Check it in Settings.');
  });

  it('refuses to "listen" on Groq instead of inventing a critique', async () => {
    await expect(listen({ project: {} as never } as never)).rejects.toThrow(/Listening needs Gemini/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Free provider (Pollinations, no key)', () => {
  beforeEach(() => useSettings.getState().set({ provider: 'free', freeKey: '', freeModel: 'openai' }));

  it('calls the free endpoint without a key and reads tool calls', async () => {
    fetchMock.mockResolvedValueOnce(sse([
      { choices: [{ delta: { reasoning: 'Tempo first.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'set_tempo', arguments: '{"bpm": 150}' } }] }, finish_reason: 'tool_calls' }] },
    ]));
    const res = await streamGenerate({ contents: [{ role: 'user', parts: [{ text: 'egg punk basic beats' }] }], tools: [{ name: 'set_tempo', description: 'tempo' }], thinking: 'MINIMAL', maxOutputTokens: 500 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://text.pollinations.ai/openai');
    expect(init.headers.Authorization).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body.model).toBe('openai');
    expect(body.reasoning_effort).toBe('low'); // always low: the free host caps replies at 1500 tokens
    expect(body.max_tokens).toBe(500);
    expect(res.content.parts).toEqual([{ functionCall: { name: 'set_tempo', args: { bpm: 150 }, id: 't1' } }]);
  });

  it('leaves voice messages out instead of sending audio it cannot hear', async () => {
    fetchMock.mockResolvedValueOnce(sse([{ choices: [{ delta: { content: 'Please type it.' }, finish_reason: 'stop' }] }]));
    await streamGenerate({ contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'audio/wav', data: btoa('RIFF') } }] }] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[0].content).toMatch(/voice message was left out/);
  });

  it('sends the optional token and explains a busy free tier', async () => {
    useSettings.getState().set({ freeKey: 'pk_token' });
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'Too many requests. Retry after 0s' }), { status: 429 }));
    const err = await streamGenerate({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }).catch((e) => e);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer pk_token');
    // Four waits, then the general retry asks once more (also waiting four times) before giving up.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(explainError(err)).toMatch(/one reply every 30 seconds/);
  }, 20_000);

  it('waits out the anonymous rate limit as the service asks, then answers', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'FREE_LIMIT', message: 'Free limit reached: 1 reply every 30 seconds per IP. Retry after 0s' } }), { status: 402 }))
      .mockResolvedValueOnce(sse([{ choices: [{ delta: { content: 'Here you go.' }, finish_reason: 'stop' }] }]));
    const waits: number[] = [];
    const res = await streamGenerate({ contents: [{ role: 'user', parts: [{ text: 'egg punk basic beats' }] }] }, { onWait: (s) => waits.push(s) });
    expect(waits).toEqual([0]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.content.parts).toEqual([{ text: 'Here you go.' }]);
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sent.reasoning_effort).toBe('low');
    expect(sent.max_tokens).toBeUndefined();
  });

  it('keeps complete tool calls from a reply cut at the length cap', async () => {
    fetchMock.mockResolvedValueOnce(sse([{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'k', function: { name: 'create_track', arguments: '{"name":"Drums"}' } }] }, finish_reason: 'length' }] }]));
    const res = await streamGenerate({ contents: [{ role: 'user', parts: [{ text: 'go' }] }] });
    expect(res.finishReason).toBe('STOP');
    expect(res.content.parts).toEqual([{ functionCall: { name: 'create_track', args: { name: 'Drums' }, id: 'k' } }]);
  });

  it('refuses to listen on the free model too', async () => {
    await expect(listen({ project: {} as never } as never)).rejects.toThrow(/the free model cannot hear audio/);
  });
});
