import { create } from 'zustand';
import { hostedAiEnabled } from '../cloud/config';
import { hasAiConsent } from '../legal/acceptance';

// User preferences, persisted to localStorage. When signed in, they also sync to the
// user's own Firestore tree (see cloud/prefs.ts); the API key is otherwise only sent
// to Google's Gemini endpoint.

export const MODELS = [
  { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', blurb: 'Fast, strong producer. Default.' },
  { id: 'gemini-4-argon', name: 'Gemini 4 Argon', blurb: 'Most capable. Best ears and arrangement sense.' },
  { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', blurb: 'Cheapest and quickest. Good for small edits.' },
] as const;

export type ModelId = (typeof MODELS)[number]['id'];

// Groq hosts open models behind an OpenAI-style API (llm.ts). Any id from
// console.groq.com/docs/models works; these are suggestions known to handle tools.
export const GROQ_MODELS = [
  { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B', blurb: 'Strongest tool use on Groq. Default.' },
  { id: 'qwen/qwen3.8-27b', name: 'Qwen 3.8 27B', blurb: 'Balanced and quick.' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', blurb: 'Fast, no thinking step.' },
] as const;
export const DEFAULT_GROQ_MODEL = GROQ_MODELS[0].id;

export type Provider = 'gemini' | 'groq';
export type Connection = 'firebase' | 'apikey';
export type Thinking = 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
export type ListeningQuality = 'full' | 'balanced' | 'compact';
export type ListeningChannels = 'stereo' | 'mono';

interface SettingsState {
  /** Which model host the agent talks to. Listening (ears) needs Gemini. */
  provider: Provider;
  model: ModelId;
  connection: Connection;
  apiKey: string;
  groqKey: string;
  groqModel: string;
  thinking: Thinking;
  /** Let the agent bounce and listen to its own work without asking. */
  autoListen: boolean;
  /** Producer preferences applied to Agent, Ask, and inline chats. */
  customInstructions: string;
  /** Live output buffer: 'stable' (bigger, no crackles) or 'low' (snappier). */
  latency: 'stable' | 'low';
  listeningQuality: ListeningQuality;
  listeningChannels: ListeningChannels;
  /** Browser noise suppression on voice messages. Off keeps humming and sung notes intact. */
  micNoiseSuppression: boolean;
  set: (patch: Partial<Omit<SettingsState, 'set'>>) => void;
}

const KEY = 'vibe:settings';

function load(): Partial<SettingsState> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
}

const envKey = (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) ?? '';
const THINKING: Thinking[] = ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'];

export const MAX_CUSTOM_INSTRUCTIONS = 4000;

export type SettingsValues = Omit<SettingsState, 'set'>;

/** Fill defaults and drop invalid values, for localStorage and for settings synced from another device. */
export function sanitizeSettings(saved: Partial<Record<keyof SettingsValues, unknown>>): SettingsValues {
  return {
    provider: saved.provider === 'groq' ? 'groq' : 'gemini',
    model: MODELS.some((m) => m.id === saved.model) ? (saved.model as ModelId) : 'gemini-3.8-flash',
    connection: hostedAiEnabled ? (saved.connection === 'apikey' ? 'apikey' : 'firebase') : 'apikey',
    apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : '',
    groqKey: typeof saved.groqKey === 'string' ? saved.groqKey : '',
    groqModel: typeof saved.groqModel === 'string' && saved.groqModel.trim() ? saved.groqModel.trim() : DEFAULT_GROQ_MODEL,
    thinking: THINKING.includes(saved.thinking as Thinking) ? (saved.thinking as Thinking) : 'MEDIUM',
    autoListen: typeof saved.autoListen === 'boolean' ? saved.autoListen : true,
    customInstructions: typeof saved.customInstructions === 'string' ? saved.customInstructions.slice(0, MAX_CUSTOM_INSTRUCTIONS) : '',
    latency: saved.latency === 'low' ? 'low' : 'stable',
    listeningQuality: saved.listeningQuality === 'balanced' || saved.listeningQuality === 'compact' ? saved.listeningQuality : 'full',
    listeningChannels: saved.listeningChannels === 'mono' ? 'mono' : 'stereo',
    micNoiseSuppression: typeof saved.micNoiseSuppression === 'boolean' ? saved.micNoiseSuppression : true,
  };
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...sanitizeSettings(load()),
  set: (patch) => {
    set(sanitizeSettings({ ...get(), ...patch }));
    const { set: _s, ...rest } = { ...get() };
    void _s;
    try {
      localStorage.setItem(KEY, JSON.stringify(rest));
    } catch { /* storage full or disabled */ }
  },
}));

/** The key to use for direct Gemini calls: user-provided first, then the dev build key. */
export function effectiveApiKey(): string {
  return useSettings.getState().apiKey.trim() || envKey.trim();
}

export function aiAvailable(): { ok: boolean; reason?: string } {
  if (!hasAiConsent()) return { ok: false, reason: 'Review the AI terms and data notice in Settings before using the agent.' };
  const s = useSettings.getState();
  if (s.provider === 'groq') {
    return s.groqKey.trim() ? { ok: true } : { ok: false, reason: 'Add a Groq API key in Settings to use the agent.' };
  }
  if (s.connection === 'firebase') {
    return hostedAiEnabled ? { ok: true } : { ok: false, reason: 'Add your Gemini API key in Settings to use the agent.' };
  }
  return effectiveApiKey() ? { ok: true } : { ok: false, reason: 'Add a Gemini API key in Settings to use the agent.' };
}
