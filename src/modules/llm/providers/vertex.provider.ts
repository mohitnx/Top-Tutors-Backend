import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI, Content, Part } from '@google/generative-ai';
import {
  ILlmProvider,
  LlmMessage,
  LlmCallOptions,
  LlmResult,
  LlmStream,
  LlmContentPart,
} from '../llm.types';
import { LlmProvider } from '../../prompts/types/prompt.types';

/**
 * Paid Vertex AI provider — uses VERTEX_AI_API_KEY for paid-tier
 * Gemini models with web search and grounding enabled by default.
 * Falls through to the free GeminiProvider when this key is absent.
 */
@Injectable()
export class VertexProvider implements ILlmProvider {
  readonly name: LlmProvider = 'vertex';
  private readonly logger = new Logger(VertexProvider.name);
  private genAI: GoogleGenerativeAI | null = null;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('VERTEX_AI_API_KEY', '');
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey.trim());
      this.logger.log('Vertex AI provider initialized (paid tier)');
    } else {
      this.logger.warn('VERTEX_AI_API_KEY not set — Vertex provider unavailable');
    }
  }

  isAvailable(): boolean {
    return !!this.genAI;
  }

  async generate(messages: LlmMessage[], options: LlmCallOptions): Promise<LlmResult> {
    const model = this.getModel(messages, options);
    const { contents } = this.toGeminiFormat(messages);

    const result = await model.generateContent({ contents });
    const usage = result.response.usageMetadata;

    return {
      text: result.response.text(),
      usage: {
        promptTokens: usage?.promptTokenCount,
        completionTokens: usage?.candidatesTokenCount,
      },
    };
  }

  async stream(messages: LlmMessage[], options: LlmCallOptions): Promise<LlmStream> {
    const model = this.getModel(messages, options);
    const { contents } = this.toGeminiFormat(messages);

    const result = await model.generateContentStream({ contents });

    let fullText = '';
    let resolvedUsage: LlmResult['usage'] | undefined;

    const iterator = (result.stream as any)[Symbol.asyncIterator]?.();
    if (!iterator || typeof iterator.next !== 'function') {
      throw new Error('Vertex AI streaming iterator not available');
    }

    const stream: LlmStream = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            const next = await iterator.next();
            if (next.done) return { done: true as const, value: '' };
            const chunk = next.value?.text ? next.value.text() : '';
            fullText += chunk;
            return { done: false, value: chunk };
          },
          async return() {
            if (typeof iterator.return === 'function') await iterator.return();
            return { done: true as const, value: '' };
          },
        };
      },
      async getResponse() {
        if (!resolvedUsage) {
          try {
            const finalResp = await result.response;
            const u = finalResp.usageMetadata;
            resolvedUsage = {
              promptTokens: u?.promptTokenCount,
              completionTokens: u?.candidatesTokenCount,
            };
          } catch {
            resolvedUsage = {};
          }
        }
        return { text: fullText, usage: resolvedUsage };
      },
    };

    return stream;
  }

  // ── Helpers ──

  private getModel(messages: LlmMessage[], options: LlmCallOptions) {
    if (!this.genAI) throw new Error('Vertex AI provider not configured');

    const systemMsg = messages.find((m) => m.role === 'system');
    const systemText = options.systemPrompt || systemMsg?.parts?.[0]?.text;

    const modelOptions: any = {
      model: options.model,
    };

    if (systemText) {
      modelOptions.systemInstruction = {
        role: 'system',
        parts: [{ text: systemText }],
      };
    }

    if (options.generationConfig) {
      const gc = options.generationConfig;
      modelOptions.generationConfig = {
        ...(gc.temperature !== undefined && { temperature: gc.temperature }),
        ...(gc.topP !== undefined && { topP: gc.topP }),
        ...(gc.maxOutputTokens !== undefined && { maxOutputTokens: gc.maxOutputTokens }),
      };
    }

    // Always enable Google Search grounding on paid tier (can be overridden via webSearch: false)
    if (options.webSearch !== false) {
      modelOptions.tools = [{ googleSearch: {} } as any];
    }

    // Enable native thinking mode for Gemini 2.5 models (real chain-of-thought)
    if (options.thinkingBudget && options.thinkingBudget > 0) {
      modelOptions.generationConfig = {
        ...modelOptions.generationConfig,
        thinkingConfig: { thinkingBudget: options.thinkingBudget },
      };
    }

    return this.genAI.getGenerativeModel(modelOptions);
  }

  private toGeminiFormat(messages: LlmMessage[]): { contents: Content[] } {
    const contents: Content[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue; // handled via systemInstruction
      contents.push({
        role: msg.role === 'user' ? 'user' : 'model',
        parts: msg.parts.map((p) => this.toGeminiPart(p)),
      });
    }

    return { contents };
  }

  private toGeminiPart(part: LlmContentPart): Part {
    if (part.inlineData) {
      return {
        inlineData: {
          mimeType: part.inlineData.mimeType,
          data: part.inlineData.data,
        },
      };
    }
    return { text: part.text || '' };
  }
}
