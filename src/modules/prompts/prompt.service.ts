import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PromptId,
  LlmProvider,
  PromptDefinition,
  PromptTemplate,
  GenerationConfig,
  ResolvedPrompt,
} from './types/prompt.types';
import { PROMPT_REGISTRY } from './definitions';

@Injectable()
export class PromptService {
  private readonly logger = new Logger(PromptService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Resolve a prompt by ID: interpolate variables, apply provider overrides,
   * and return everything the caller needs to make an LLM call.
   */
  resolve(
    id: PromptId,
    variables?: Record<string, string>,
    overrides?: {
      provider?: LlmProvider;
      generationConfig?: Partial<GenerationConfig>;
      model?: string;
    },
  ): ResolvedPrompt {
    const def = this.getDefinition(id);
    const provider = overrides?.provider;

    // Check for env-var override (applies to any prompt's system prompt)
    const envOverride =
      this.configService.get<string>('AI_SYSTEM_PROMPT') ||
      this.configService.get<string>('GEMINI_SYSTEM_PROMPT');

    const systemPrompt = def.systemPrompt
      ? envOverride && envOverride.trim() && id === 'tutor-chat-single'
        ? envOverride.trim()
        : this.interpolate(def.systemPrompt, provider, variables)
      : null;

    const userPrompt = def.userPrompt
      ? this.interpolate(def.userPrompt, provider, variables)
      : null;

    // Merge generation config: base → provider overrides → caller overrides
    const genConfig = this.mergeConfig(
      def.generationConfig,
      provider,
      overrides?.generationConfig,
    );

    // Select models
    let models: string[];
    if (overrides?.model) {
      models = [overrides.model];
    } else if (provider && def.providerModels?.[provider]) {
      models = def.providerModels[provider]!;
    } else {
      models = def.models;
    }

    return {
      systemPrompt,
      userPrompt,
      generationConfig: genConfig,
      models,
      outputFormat: def.outputFormat,
    };
  }

  /**
   * Get only the generation config and model list for a prompt.
   * Useful for dynamic prompts where the caller builds the text itself
   * (e.g., council synthesis, cross-review).
   */
  getConfig(
    id: PromptId,
    provider?: LlmProvider,
  ): { generationConfig: GenerationConfig; models: string[] } {
    const def = this.getDefinition(id);
    const genConfig = this.mergeConfig(def.generationConfig, provider);
    const models =
      provider && def.providerModels?.[provider]
        ? def.providerModels[provider]!
        : def.models;

    return { generationConfig: genConfig, models };
  }

  /**
   * Get the raw prompt definition for inspection or documentation.
   */
  getDefinition(id: PromptId): PromptDefinition {
    const def = PROMPT_REGISTRY.get(id);
    if (!def) {
      throw new Error(`Prompt definition not found: ${id}`);
    }
    return def;
  }

  /**
   * List all registered prompts with metadata.
   */
  listAll(): Array<{ id: PromptId; description: string; category: string }> {
    return Array.from(PROMPT_REGISTRY.values()).map((d) => ({
      id: d.id,
      description: d.description,
      category: d.category,
    }));
  }

  // ─── Private helpers ───────────────────────────────────────

  private interpolate(
    template: PromptTemplate,
    provider?: LlmProvider,
    variables?: Record<string, string>,
  ): string {
    let text =
      provider && template.providerText?.[provider]
        ? template.providerText[provider]!
        : template.text;

    if (variables) {
      for (const [key, value] of Object.entries(variables)) {
        text = text.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
      }
    }

    // Remove any un-replaced optional variables ({{var?}}) — leave required ones for debugging
    text = text.replace(/\{\{(\w+)\?\}\}/g, '');

    return text;
  }

  private mergeConfig(
    base: GenerationConfig,
    provider?: LlmProvider,
    callerOverrides?: Partial<GenerationConfig>,
  ): GenerationConfig {
    const providerExtras =
      provider && base.providerOverrides?.[provider]
        ? base.providerOverrides[provider]
        : {};

    const merged: GenerationConfig = {
      temperature: base.temperature,
      topP: base.topP,
      maxOutputTokens: base.maxOutputTokens,
      ...providerExtras,
    };

    if (callerOverrides) {
      if (callerOverrides.temperature !== undefined) merged.temperature = callerOverrides.temperature;
      if (callerOverrides.topP !== undefined) merged.topP = callerOverrides.topP;
      if (callerOverrides.maxOutputTokens !== undefined) merged.maxOutputTokens = callerOverrides.maxOutputTokens;
    }

    // Strip providerOverrides from the returned config (already applied)
    delete merged.providerOverrides;
    return merged;
  }
}
