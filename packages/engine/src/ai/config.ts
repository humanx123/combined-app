/**
 * AI provider configuration for the combined gesture-DAW platform.
 *
 * Supports multiple AI providers:
 * - Google Gemini (default)
 * - Groq (alternative, faster/cheaper)
 *
 * The user can switch providers at runtime without rebuilding.
 */

/** Supported AI providers. */
export type AIProvider = 'gemini' | 'groq';

/** Configuration for an AI provider. */
export interface AIProviderConfig {
  provider: AIProvider;
  apiKey: string;
  model: string;
  enabled: boolean;
  endpoint?: string;
}

/** Available Gemini models. */
export const GEMINI_MODELS = {
  'gemini-3.8-flash': { name: 'Gemini 3.8 Flash', description: 'Fast, strong at tool use (default)' },
  'gemini-4-argon': { name: 'Gemini 4 Argon', description: 'Most capable; best musical judgment' },
  'gemini-3.5-flash-lite': { name: 'Gemini 3.5 Flash Lite', description: 'Cheapest and fastest; good for small edits' },
} as const;

/** Available Groq models. */
export const GROQ_MODELS = {
  'llama-3.3-70b-versatile': { name: 'Llama 3.3 70B', description: 'Powerful open-source model' },
  'llama-3.1-8b-instant': { name: 'Llama 3.1 8B', description: 'Fast and lightweight' },
  'mixtral-8x7b-32768': { name: 'Mixtral 8x7B', description: 'Great at creative writing and music' },
  'gemma-2-9b-it': { name: 'Gemma 2 9B', description: 'Google open-source model' },
} as const;

/** Default models per provider. */
export const DEFAULT_MODELS: Record<AIProvider, string> = {
  gemini: 'gemini-3.8-flash',
  groq: 'llama-3.3-70b-versatile',
};

/** API endpoints per provider. */
export const API_ENDPOINTS: Record<AIProvider, string> = {
  gemini: 'https://generativelanguage.googleapis.com/v1beta',
  groq: 'https://api.groq.com/openai/v1',
};

/**
 * Load AI configuration from environment variables.
 *
 * Reads from VITE_GEMINI_API_KEY and VITE_GROQ_API_KEY.
 * Falls back to defaults if not set.
 */
export function loadAIConfig(): AIProviderConfig[] {
  const configs: AIProviderConfig[] = [];

  // Gemini configuration
  const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (geminiKey && geminiKey !== 'placeholder_gemini_key_replace_with_your_key') {
    configs.push({
      provider: 'gemini',
      apiKey: geminiKey,
      model: import.meta.env.VITE_GEMINI_MODEL || DEFAULT_MODELS.gemini,
      enabled: true,
      endpoint: API_ENDPOINTS.gemini,
    });
  }

  // Groq configuration
  const groqKey = import.meta.env.VITE_GROQ_API_KEY;
  if (groqKey && groqKey !== 'placeholder_groq_key_replace_with_your_key') {
    configs.push({
      provider: 'groq',
      apiKey: groqKey,
      model: import.meta.env.VITE_GROQ_MODEL || DEFAULT_MODELS.groq,
      enabled: true,
      endpoint: API_ENDPOINTS.groq,
    });
  }

  return configs;
}

/**
 * Get the active AI provider configuration.
 *
 * Priority: VITE_AI_PROVIDER env var > first enabled config > gemini default
 */
export function getActiveProvider(): AIProviderConfig | null {
  const configs = loadAIConfig();
  const preferred = import.meta.env.VITE_AI_PROVIDER as AIProvider;

  if (preferred && configs.some((c) => c.provider === preferred && c.enabled)) {
    return configs.find((c) => c.provider === preferred)!;
  }

  // Return first enabled config
  const enabled = configs.find((c) => c.enabled);
  if (enabled) return enabled;

  // Fallback to gemini if configured
  return configs.find((c) => c.provider === 'gemini') || null;
}

/**
 * Check if a specific provider is available.
 */
export function isProviderAvailable(provider: AIProvider): boolean {
  const configs = loadAIConfig();
  return configs.some((c) => c.provider === provider && c.enabled);
}

/**
 * Get all available providers.
 */
export function getAvailableProviders(): AIProvider[] {
  return loadAIConfig().map((c) => c.provider);
}

/**
 * Switch the active provider at runtime.
 * This updates a global variable that the AI client reads.
 */
export function switchProvider(provider: AIProvider): boolean {
  const config = loadAIConfig().find((c) => c.provider === provider);
  if (!config || !config.enabled) {
    console.warn(`Provider ${provider} is not available`);
    return false;
  }

  if (typeof window !== 'undefined') {
    (window as any).__ACTIVE_AI_PROVIDER__ = provider;
    (window as any).__ACTIVE_AI_CONFIG__ = config;
  }

  return true;
}

/**
 * Get the current active provider (from runtime switch or default).
 */
export function getCurrentProvider(): AIProviderConfig | null {
  if (typeof window !== 'undefined' && (window as any).__ACTIVE_AI_CONFIG__) {
    return (window as any).__ACTIVE_AI_CONFIG__;
  }
  return getActiveProvider();
}