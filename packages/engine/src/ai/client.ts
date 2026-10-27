/**
 * AI client supporting both Google Gemini and Groq.
 *
 * The client abstracts the differences between providers so that the
 * agent loop and tools work the same regardless of which backend is used.
 */

import { loadAIConfig, getActiveProvider, getCurrentProvider, API_ENDPOINTS } from './config';
import type { AIProviderConfig } from './config';

/** A chat message in the conversation. */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** A tool declaration for the AI. */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

/** Response from the AI client. */
export interface AIResponse {
  text: string;
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
  }>;
}

/**
 * AI client that supports multiple providers.
 */
class AIClient {
  private config: AIProviderConfig | null = null;

  /** Get the current provider config. */
  private getConfig(): AIProviderConfig {
    if (this.config) return this.config;
    this.config = getCurrentProvider() || getActiveProvider();
    if (!this.config) {
      throw new Error('No AI provider configured. Set VITE_GEMINI_API_KEY or VITE_GROQ_API_KEY.');
    }
    return this.config;
  }

  /** Send a chat completion request. */
  async chat(
    messages: ChatMessage[],
    tools?: ToolDeclaration[],
    systemPrompt?: string,
  ): Promise<AIResponse> {
    const config = this.getConfig();

    if (config.provider === 'gemini') {
      return this.chatGemini(messages, tools, systemPrompt, config);
    } else if (config.provider === 'groq') {
      return this.chatGroq(messages, tools, systemPrompt, config);
    }

    throw new Error(`Unknown provider: ${config.provider}`);
  }

  /** Chat with Google Gemini. */
  private async chatGemini(
    messages: ChatMessage[],
    tools?: ToolDeclaration[],
    systemPrompt?: string,
    config?: AIProviderConfig,
  ): Promise<AIResponse> {
    const cfg = config || this.getConfig();

    // Convert messages to Gemini format
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    };

    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    if (tools && tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    const response = await fetch(
      `${cfg.endpoint}/models/${cfg.model}:generateContent?key=${cfg.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      throw new Error(`Gemini API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts?.[0]?.text || '';

    // Extract tool calls
    const toolCalls = candidate?.content?.parts
      ?.filter((p: any) => p.functionCall)
      ?.map((p: any) => ({
        name: p.functionCall.name,
        args: p.functionCall.args,
      }));

    return { text, toolCalls };
  }

  /** Chat with Groq (OpenAI-compatible API). */
  private async chatGroq(
    messages: ChatMessage[],
    tools?: ToolDeclaration[],
    systemPrompt?: string,
    config?: AIProviderConfig,
  ): Promise<AIResponse> {
    const cfg = config || this.getConfig();

    const allMessages: ChatMessage[] = [];
    if (systemPrompt) {
      allMessages.push({ role: 'system', content: systemPrompt });
    }
    allMessages.push(...messages);

    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: allMessages,
      temperature: 0.7,
      max_tokens: 2048,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const response = await fetch(`${cfg.endpoint}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Groq API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const choice = data.choices?.[0];
    const message = choice?.message;
    const text = message?.content || '';

    // Extract tool calls
    const toolCalls = message?.tool_calls?.map((tc: any) => ({
      name: tc.function.name,
      args: JSON.parse(tc.function.arguments || '{}'),
    }));

    return { text, toolCalls };
  }

  /** Switch the active provider. */
  switchProvider(provider: 'gemini' | 'groq'): void {
    // Re-load config with the new provider
    this.config = null;
    const config = getCurrentProvider();
    if (config && config.provider === provider) {
      this.config = config;
    } else {
      // Force the switch
      if (typeof window !== 'undefined') {
        (window as any).__ACTIVE_AI_PROVIDER__ = provider;
      }
      this.config = getCurrentProvider() || getActiveProvider();
    }
  }

  /** Get the current provider name. */
  getProviderName(): string {
    return this.getConfig().provider;
  }
}

/** Singleton AI client. */
export const aiClient = new AIClient();