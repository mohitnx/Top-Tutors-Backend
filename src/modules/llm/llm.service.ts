import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmProvider } from '../prompts/types/prompt.types';
import { PromptService } from '../prompts/prompt.service';
import {
  ILlmProvider,
  LlmMessage,
  LlmCallOptions,
  LlmResult,
  LlmStream,
  LlmContentPart,
} from './llm.types';
import { GeminiProvider } from './providers/gemini.provider';
import { VertexProvider } from './providers/vertex.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAIProvider } from './providers/openai.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';
import { PromptId, ResolvedPrompt } from '../prompts/types/prompt.types';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly providers = new Map<LlmProvider, ILlmProvider>();
  private readonly defaultProvider: LlmProvider;

  constructor(
    private readonly config: ConfigService,
    private readonly promptService: PromptService,
    gemini: GeminiProvider,
    vertex: VertexProvider,
    anthropic: AnthropicProvider,
    openai: OpenAIProvider,
    deepseek: DeepSeekProvider,
  ) {
    // Register all providers
    this.providers.set('gemini', gemini);
    this.providers.set('vertex', vertex);
    this.providers.set('anthropic', anthropic);
    this.providers.set('openai', openai);
    this.providers.set('deepseek', deepseek);

    // Default provider priority: anthropic (paid) > vertex (paid Gemini) > env setting > gemini (free fallback)
    const envProvider = this.config.get<string>('LLM_PROVIDER', 'gemini') as LlmProvider;
    if (anthropic.isAvailable()) {
      this.defaultProvider = 'anthropic';
    } else if (vertex.isAvailable()) {
      this.defaultProvider = 'vertex';
    } else if (this.providers.get(envProvider)?.isAvailable()) {
      this.defaultProvider = envProvider;
    } else {
      this.defaultProvider = 'gemini';
    }

    const available = Array.from(this.providers.entries())
      .filter(([, p]) => p.isAvailable())
      .map(([name]) => name);

    this.logger.log(
      `LLM Service ready — default: ${this.defaultProvider}, available: [${available.join(', ')}]`,
    );
  }

  // ═══════════════════════════════════════════════════════════
  // High-level API: prompt-registry-aware methods
  // ═══════════════════════════════════════════════════════════

  /**
   * Generate a response using a registered prompt.
   * Resolves the prompt, picks the provider/model, and calls generate().
   */
  async generateFromPrompt(
    promptId: PromptId,
    variables?: Record<string, string>,
    options?: {
      provider?: LlmProvider;
      /** Additional user content parts (inline data, extra text) */
      userParts?: LlmContentPart[];
      /** Override generation config */
      generationConfig?: Partial<Record<string, any>>;
    },
  ): Promise<LlmResult> {
    const provider = options?.provider || this.defaultProvider;
    const resolved = this.promptService.resolve(promptId, variables, { provider });

    const messages: LlmMessage[] = [];

    // Build user message from resolved prompt + extra parts
    const userParts: LlmContentPart[] = [];
    if (options?.userParts) {
      userParts.push(...options.userParts);
    }
    if (resolved.userPrompt) {
      userParts.push({ text: resolved.userPrompt });
    }
    if (userParts.length > 0) {
      messages.push({ role: 'user', parts: userParts });
    }

    return this.generateWithFallback(messages, {
      systemPrompt: resolved.systemPrompt || undefined,
      generationConfig: resolved.generationConfig,
      models: resolved.models,
      provider,
    });
  }

  /**
   * Stream a response using a registered prompt.
   */
  async streamFromPrompt(
    promptId: PromptId,
    variables?: Record<string, string>,
    options?: {
      provider?: LlmProvider;
      history?: LlmMessage[];
      userParts?: LlmContentPart[];
      generationConfig?: Partial<Record<string, any>>;
    },
  ): Promise<LlmStream> {
    const provider = options?.provider || this.defaultProvider;
    const resolved = this.promptService.resolve(promptId, variables, { provider });

    const messages: LlmMessage[] = options?.history ? [...options.history] : [];

    // Build user message
    const userParts: LlmContentPart[] = [];
    if (options?.userParts) {
      userParts.push(...options.userParts);
    }
    if (resolved.userPrompt) {
      userParts.push({ text: resolved.userPrompt });
    }
    if (userParts.length > 0) {
      messages.push({ role: 'user', parts: userParts });
    }

    return this.streamWithFallback(messages, {
      systemPrompt: resolved.systemPrompt || undefined,
      generationConfig: resolved.generationConfig,
      models: resolved.models,
      provider,
    });
  }

  // ═══════════════════════════════════════════════════════════
  // Low-level API: direct provider access
  // ═══════════════════════════════════════════════════════════

  /**
   * Generate with automatic model fallback.
   * Tries each model in the list until one succeeds.
   */
  async generateWithFallback(
    messages: LlmMessage[],
    options: {
      systemPrompt?: string;
      generationConfig?: Record<string, any>;
      models: string[];
      provider?: LlmProvider;
      webSearch?: boolean;
      thinkingBudget?: number;
      maxWebSearches?: number;
    },
  ): Promise<LlmResult> {
    const providerName = options.provider || this.defaultProvider;
    const errors: string[] = [];

    // Build common call options (reused for primary + fallback)
    const makeCallOpts = (model: string): LlmCallOptions => ({
      model,
      systemPrompt: options.systemPrompt,
      generationConfig: options.generationConfig as any,
      webSearch: options.webSearch,
      thinkingBudget: options.thinkingBudget,
      maxWebSearches: options.maxWebSearches,
    });

    // ── Phase 1: try every model on the primary provider ──
    const provider = this.providers.get(providerName);
    if (provider?.isAvailable()) {
      for (const model of options.models) {
        try {
          const result = await provider.generate(messages, makeCallOpts(model));
          this.logger.log(`✅ [${providerName}] Generated with model: ${model}`);
          return result;
        } catch (error: any) {
          const msg = `[${providerName}] Model ${model} failed: ${error.message}`;
          this.logger.warn(msg);
          errors.push(msg);
        }
      }
    } else {
      const msg = `[${providerName}] Provider unavailable — skipping to fallback chain`;
      this.logger.warn(msg);
      errors.push(msg);
    }

    // ── Phase 2: cross-provider fallback chain ──
    const fallbackChain: { provider: LlmProvider; model: string }[] = [];
    if (providerName !== 'anthropic' && this.isProviderAvailable('anthropic')) {
      fallbackChain.push({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    }
    if (providerName !== 'vertex' && this.isProviderAvailable('vertex')) {
      fallbackChain.push({ provider: 'vertex', model: 'gemini-2.5-flash' });
    }
    if (providerName !== 'gemini' && this.isProviderAvailable('gemini')) {
      fallbackChain.push({ provider: 'gemini', model: 'gemini-2.5-flash' });
    }
    if (providerName !== 'openai' && this.isProviderAvailable('openai')) {
      fallbackChain.push({ provider: 'openai', model: 'gpt-4o-mini' });
    }
    if (providerName !== 'deepseek' && this.isProviderAvailable('deepseek')) {
      fallbackChain.push({ provider: 'deepseek', model: 'deepseek-chat' });
    }

    for (const fallback of fallbackChain) {
      this.logger.warn(`[${providerName}] All models failed — trying ${fallback.provider}`);
      try {
        const result = await this.getProvider(fallback.provider).generate(
          messages,
          makeCallOpts(fallback.model),
        );
        this.logger.log(`✅ [${fallback.provider}] Fallback generated with model: ${fallback.model}`);
        return result;
      } catch (fallbackError: any) {
        const msg = `[${fallback.provider}] Fallback also failed: ${fallbackError.message}`;
        this.logger.error(msg);
        errors.push(msg);
      }
    }

    throw new Error(
      `All providers/models exhausted. Provider: ${providerName}, models: [${options.models.join(', ')}]. Errors:\n${errors.join('\n')}`,
    );
  }

  /**
   * Stream with automatic model fallback.
   * Tries each model until one returns a stream successfully.
   */
  async streamWithFallback(
    messages: LlmMessage[],
    options: {
      systemPrompt?: string;
      generationConfig?: Record<string, any>;
      models: string[];
      provider?: LlmProvider;
      webSearch?: boolean;
      thinkingBudget?: number;
      maxWebSearches?: number;
    },
  ): Promise<LlmStream> {
    const providerName = options.provider || this.defaultProvider;
    const errors: string[] = [];

    const makeCallOpts = (model: string): LlmCallOptions => ({
      model,
      systemPrompt: options.systemPrompt,
      generationConfig: options.generationConfig as any,
      webSearch: options.webSearch,
      thinkingBudget: options.thinkingBudget,
      maxWebSearches: options.maxWebSearches,
    });

    // ── Phase 1: try every model on the primary provider ──
    const provider = this.providers.get(providerName);
    if (provider?.isAvailable()) {
      for (const model of options.models) {
        try {
          const stream = await provider.stream(messages, makeCallOpts(model));
          this.logger.log(`✅ [${providerName}] Streaming with model: ${model}`);
          return stream;
        } catch (error: any) {
          const msg = `[${providerName}] Stream model ${model} failed: ${error.message}`;
          this.logger.warn(msg);
          errors.push(msg);
        }
      }
    } else {
      const msg = `[${providerName}] Provider unavailable — skipping to fallback chain`;
      this.logger.warn(msg);
      errors.push(msg);
    }

    // ── Phase 2: cross-provider fallback chain ──
    const fallbackChain: { provider: LlmProvider; model: string }[] = [];
    if (providerName !== 'anthropic' && this.isProviderAvailable('anthropic')) {
      fallbackChain.push({ provider: 'anthropic', model: 'claude-sonnet-4-20250514' });
    }
    if (providerName !== 'vertex' && this.isProviderAvailable('vertex')) {
      fallbackChain.push({ provider: 'vertex', model: 'gemini-2.5-flash' });
    }
    if (providerName !== 'gemini' && this.isProviderAvailable('gemini')) {
      fallbackChain.push({ provider: 'gemini', model: 'gemini-2.5-flash' });
    }
    if (providerName !== 'openai' && this.isProviderAvailable('openai')) {
      fallbackChain.push({ provider: 'openai', model: 'gpt-4o-mini' });
    }
    if (providerName !== 'deepseek' && this.isProviderAvailable('deepseek')) {
      fallbackChain.push({ provider: 'deepseek', model: 'deepseek-chat' });
    }

    for (const fallback of fallbackChain) {
      this.logger.warn(`[${providerName}] All stream models failed — trying ${fallback.provider}`);
      try {
        const stream = await this.getProvider(fallback.provider).stream(
          messages,
          makeCallOpts(fallback.model),
        );
        this.logger.log(`✅ [${fallback.provider}] Fallback streaming with model: ${fallback.model}`);
        return stream;
      } catch (fallbackError: any) {
        const msg = `[${fallback.provider}] Stream fallback also failed: ${fallbackError.message}`;
        this.logger.error(msg);
        errors.push(msg);
      }
    }

    throw new Error(
      `All stream providers/models exhausted. Provider: ${providerName}, models: [${options.models.join(', ')}]. Errors:\n${errors.join('\n')}`,
    );
  }

  /**
   * Direct access to a specific provider's generate().
   */
  async generate(
    provider: LlmProvider,
    messages: LlmMessage[],
    options: LlmCallOptions,
  ): Promise<LlmResult> {
    return this.getProvider(provider).generate(messages, options);
  }

  /**
   * Direct access to a specific provider's stream().
   */
  async stream(
    provider: LlmProvider,
    messages: LlmMessage[],
    options: LlmCallOptions,
  ): Promise<LlmStream> {
    return this.getProvider(provider).stream(messages, options);
  }

  // ═══════════════════════════════════════════════════════════
  // Utility
  // ═══════════════════════════════════════════════════════════

  /** Get the currently active default provider name */
  getDefaultProvider(): LlmProvider {
    return this.defaultProvider;
  }

  /** Check if a specific provider is available (has API key) */
  isProviderAvailable(provider: LlmProvider): boolean {
    return this.providers.get(provider)?.isAvailable() ?? false;
  }

  /** List all available providers, default provider first */
  getAvailableProviders(): LlmProvider[] {
    const available = Array.from(this.providers.entries())
      .filter(([, p]) => p.isAvailable())
      .map(([name]) => name);
    // Ensure the default provider is tried first
    const idx = available.indexOf(this.defaultProvider);
    if (idx > 0) {
      available.splice(idx, 1);
      available.unshift(this.defaultProvider);
    }
    return available;
  }

  /** Get the resolved prompt with the default provider applied */
  resolvePrompt(
    promptId: PromptId,
    variables?: Record<string, string>,
    provider?: LlmProvider,
  ): ResolvedPrompt {
    return this.promptService.resolve(promptId, variables, {
      provider: provider || this.defaultProvider,
    });
  }

  private getProvider(name: LlmProvider): ILlmProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Unknown LLM provider: ${name}`);
    }
    if (!provider.isAvailable()) {
      throw new Error(`LLM provider ${name} is not configured (missing API key)`);
    }
    return provider;
  }
}
