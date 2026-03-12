export type PromptId =
  | 'tutor-chat-single'
  | 'tutor-chat-council-conceptual'
  | 'tutor-chat-council-practical'
  | 'tutor-chat-council-clarity'
  | 'tutor-chat-council-review'
  | 'tutor-chat-council-synthesis'
  | 'title-generation'
  | 'subject-detection'
  | 'conversation-analysis'
  | 'ocr-question-extraction'
  | 'question-ranking-answering'
  | 'project-chat'
  | 'quiz-generation'
  | 'resource-text-extraction'
  | 'audio-transcription'
  | 'message-classification';

export type LlmProvider = 'gemini' | 'openai' | 'anthropic' | 'deepseek';

/** Model-agnostic generation config with optional provider-specific overrides */
export interface GenerationConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  /** Provider-specific params merged on top of the base config at resolve time */
  providerOverrides?: Partial<Record<LlmProvider, Record<string, any>>>;
}

/** A prompt template supporting {{variable}} interpolation and provider-specific text */
export interface PromptTemplate {
  /** Base prompt text (model-agnostic). Use {{variableName}} for dynamic values. */
  text: string;
  /** Provider-specific rewording of the prompt (merged at resolve time) */
  providerText?: Partial<Record<LlmProvider, string>>;
}

/** Full definition of a registered prompt */
export interface PromptDefinition {
  id: PromptId;
  description: string;
  category: 'chat' | 'council' | 'classification' | 'extraction' | 'generation';
  /** System prompt template (null for user-message-only prompts) */
  systemPrompt?: PromptTemplate;
  /** User prompt template (for single-shot prompts like OCR, classification) */
  userPrompt?: PromptTemplate;
  /** Default generation parameters */
  generationConfig: GenerationConfig;
  /** Model names to try in order (default / Gemini) */
  models: string[];
  /** Provider-specific model fallback lists */
  providerModels?: Partial<Record<LlmProvider, string[]>>;
  /** Expected output format */
  outputFormat: 'text' | 'json' | 'markdown' | 'streaming-markdown';
  /** Template variable names this prompt expects (for documentation / validation) */
  variables: string[];
}

/** Result of PromptService.resolve() — everything needed to make an LLM call */
export interface ResolvedPrompt {
  systemPrompt: string | null;
  userPrompt: string | null;
  generationConfig: GenerationConfig;
  models: string[];
  outputFormat: string;
}
