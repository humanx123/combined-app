import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const cache = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => cache.get(k) ?? null, setItem: (k: string, v: string) => cache.set(k, v), removeItem: (k: string) => cache.delete(k) } });
});
const sdk = vi.hoisted(() => ({ configs: [] as Array<Record<string, unknown>>, refuseAll: false }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = {
      generateContentStream: async (args: { config: { thinkingConfig?: { thinkingLevel?: string } } }) => {
        sdk.configs.push(args.config as never);
        // Like the model that failed for a user: it refuses MINIMAL and, with no level given, defaults to MINIMAL.
        const level = args.config.thinkingConfig ? args.config.thinkingConfig.thinkingLevel ?? 'MINIMAL' : null;
        if (level === 'MINIMAL' || (sdk.refuseAll && level !== null)) {
          // The exact error text a user got from Gemini.
          throw new Error('{"error":{"message":"{\\n  \\"error\\": {\\n    \\"code\\": 400,\\n    \\"message\\": \\"Thinking level MINIMAL is not supported for this model. Please retry with other thinking level.\\",\\n    \\"status\\": \\"INVALID_ARGUMENT\\"\\n  }\\n}\\n","code":400,"status":""}}');
        }
        return (async function* () { yield { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }] }; })();
      },
    };
  },
}));
vi.mock('../cloud/firebase', () => ({ getFirebaseApp: async () => null }));

import { streamGenerate } from './llm';
import { useSettings } from '../state/settings';
import { acknowledgeAi } from '../legal/acceptance';

beforeEach(() => {
  acknowledgeAi(true);
  sdk.configs = [];
  sdk.refuseAll = false;
  useSettings.getState().set({ provider: 'gemini', apiKey: 'AIza-test', connection: 'apikey', thinking: 'MINIMAL' });
});

describe('Gemini thinking levels', () => {
  const ask = (model: string) => streamGenerate({ model, contents: [{ role: 'user', parts: [{ text: 'egg punk basic beats' }] }], thinking: 'MINIMAL' });
  const levels = () => sdk.configs.map((c) => (c.thinkingConfig as { thinkingLevel?: string } | undefined) ? (c.thinkingConfig as { thinkingLevel?: string }).thinkingLevel ?? 'default' : 'none');

  it('steps up to LOW when the model refuses MINIMAL and its own default, then remembers it', async () => {
    const res = await ask('gemini-model-a');
    expect(res.content.parts[0].text).toBe('ok');
    expect(levels()).toEqual(['MINIMAL', 'LOW']);
    sdk.configs = [];
    await ask('gemini-model-a');
    expect(levels()).toEqual(['LOW']);
  });

  it('drops thinking settings entirely when every level is refused', async () => {
    sdk.refuseAll = true;
    const res = await ask('gemini-model-b');
    expect(res.content.parts[0].text).toBe('ok');
    expect(levels()).toEqual(['MINIMAL', 'LOW', 'none']);
  });
});
