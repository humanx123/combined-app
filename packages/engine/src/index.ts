/**
 * @combined-app/engine
 *
 * Shared audio engine, state management, plugin system, and AI client
 * for the combined Gesture Synth Weld + Vibe DAW platform.
 */

// Audio
export { audioEngine, UnifiedAudioEngine, EngineGraph } from './audio';
export type { GraphNode } from './audio/graph';

// State
export { useCombinedStore, initialState } from './state';
export type { CombinedStore, CombinedActions } from './state';

// Plugins
export { pluginRegistry, builtInInstruments, builtInEffects } from './plugins';
export type { InstrumentPlugin, EffectPlugin } from './plugins';

// AI
export { aiClient } from './ai';
export {
  loadAIConfig,
  getActiveProvider,
  getCurrentProvider,
  switchProvider,
  isProviderAvailable,
  getAvailableProviders,
  GEMINI_MODELS,
  GROQ_MODELS,
  DEFAULT_MODELS,
  API_ENDPOINTS,
} from './ai/config';
export type {
  AIProvider,
  AIProviderConfig,
  ChatMessage,
  ToolDeclaration,
  AIResponse,
} from './ai/client';

// Types
export type {
  MidiNote,
  Frequency,
  Velocity,
  Seconds,
  Beats,
  Project,
  Track,
  Clip,
  HandFrame,
  Landmark,
  GestureEvent,
  InstrumentPreset,
  EffectInstance,
  Suggestion,
  ReferenceTrack,
  CombinedState,
  Checkpoint,
  HistoryEntry,
  Result,
  Unsubscribe,
} from './types';