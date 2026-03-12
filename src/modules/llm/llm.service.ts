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
    anthropic: AnthropicProvider,
    openai: OpenAIProvider,
    deepseek: DeepSeekProvider,
  ) {
    // Register all providers
    this.providers.set('gemini', gemini);
    this.providers.set('anthropic', anthropic);
    this.providers.set('openai', openai);
    this.providers.set('deepseek', deepseek);

    // Default provider: prefer anthropic if available, then env setting, then gemini
    const envProvider = this.config.get<string>('LLM_PROVIDER', 'gemini') as LlmProvider;
    if (anthropic.isAvailable()) {
      this.defaultProvider = 'anthropic';
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
    },
  ): Promise<LlmResult> {
    const providerName = options.provider || this.defaultProvider;
    const provider = this.getProvider(providerName);

    for (const model of options.models) {
      try {
        return await provider.generate(messages, {
          model,
          systemPrompt: options.systemPrompt,
          generationConfig: options.generationConfig as any,
        });
      } catch (error: any) {
        this.logger.warn(`[${providerName}] Model ${model} failed: ${error.message}`);
        continue;
      }
    }

    // Cross-provider fallback: try gemini if primary provider failed
    if (providerName !== 'gemini' && this.isProviderAvailable('gemini')) {
      this.logger.warn(`[${providerName}] All models failed — falling back to gemini`);
      try {
        return await this.getProvider('gemini').generate(messages, {
          model: 'gemini-2.5-flash',
          systemPrompt: options.systemPrompt,
          generationConfig: options.generationConfig as any,
        });
      } catch (fallbackError: any) {
        this.logger.error(`[gemini] Fallback also failed: ${fallbackError.message}`);
      }
    }

    throw new Error(
      `All models failed for provider ${providerName}: [${options.models.join(', ')}]`,
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
    },
  ): Promise<LlmStream> {
    const providerName = options.provider || this.defaultProvider;
    const provider = this.getProvider(providerName);

    for (const model of options.models) {
      try {
        return await provider.stream(messages, {
          model,
          systemPrompt: options.systemPrompt,
          generationConfig: options.generationConfig as any,
        });
      } catch (error: any) {
        this.logger.warn(`[${providerName}] Stream model ${model} failed: ${error.message}`);
        continue;
      }
    }

    // Cross-provider fallback: try gemini if primary provider failed
    if (providerName !== 'gemini' && this.isProviderAvailable('gemini')) {
      this.logger.warn(`[${providerName}] All stream models failed — falling back to gemini`);
      try {
        return await this.getProvider('gemini').stream(messages, {
          model: 'gemini-2.5-flash',
          systemPrompt: options.systemPrompt,
          generationConfig: options.generationConfig as any,
        });
      } catch (fallbackError: any) {
        this.logger.error(`[gemini] Stream fallback also failed: ${fallbackError.message}`);
      }
    }

    throw new Error(
      `All stream models failed for provider ${providerName}: [${options.models.join(', ')}]`,
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

  /** List all available providers */
  getAvailableProviders(): LlmProvider[] {
    return Array.from(this.providers.entries())
      .filter(([, p]) => p.isAvailable())
      .map(([name]) => name);
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
