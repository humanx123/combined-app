export { aiClient, AIClient } from './client';
export { loadAIConfig, getActiveProvider, getCurrentProvider, switchProvider, isProviderAvailable, getAvailableProviders } from './config';
export type { AIProvider, AIProviderConfig, ChatMessage, ToolDeclaration, AIResponse } from './client';
export { GEMINI_MODELS, GROQ_MODELS, DEFAULT_MODELS, API_ENDPOINTS } from './config';