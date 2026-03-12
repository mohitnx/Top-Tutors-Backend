import { LlmProvider, GenerationConfig } from '../prompts/types/prompt.types';

/**
 * A single content part — text or inline binary data (image/audio/pdf).
 */
export interface LlmContentPart {
  text?: string;
  inlineData?: {
    mimeType: string;
    data: string; // base64
  };
}

/**
 * A message in the conversation history.
 */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  parts: LlmContentPart[];
}

/**
 * Options for a single LLM call (generation or streaming).
 */
export interface LlmCallOptions {
  model: string;
  systemPrompt?: string;
  generationConfig?: GenerationConfig;
  /** Enable web search grounding — LLM can fetch real-time info from the internet */
  webSearch?: boolean;
}

/**
 * Result of a non-streaming LLM call.
 */
export interface LlmResult {
  text: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
  };
}

/**
 * An async iterable that yields text chunks for streaming.
 * Call `getResponse()` after iteration completes to get final usage stats.
 */
export interface LlmStream {
  [Symbol.asyncIterator](): AsyncIterator<string>;
  /** Resolves with full response + usage after stream ends */
  getResponse(): Promise<LlmResult>;
}

/**
 * Provider interface — each LLM provider (Gemini, OpenAI, Anthropic, DeepSeek)
 * implements this to enable seamless switching.
 */
export interface ILlmProvider {
  readonly name: LlmProvider;

  /** Whether this provider is configured (API key present) */
  isAvailable(): boolean;

  /** Non-streaming generation */
  generate(
    messages: LlmMessage[],
    options: LlmCallOptions,
  ): Promise<LlmResult>;

  /** Streaming generation */
  stream(
    messages: LlmMessage[],
    options: LlmCallOptions,
  ): Promise<LlmStream>;
}
