import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  ILlmProvider,
  LlmMessage,
  LlmCallOptions,
  LlmResult,
  LlmStream,
  LlmContentPart,
} from '../llm.types';
import { LlmProvider } from '../../prompts/types/prompt.types';

@Injectable()
export class OpenAIProvider implements ILlmProvider {
  readonly name: LlmProvider = 'openai';
  private readonly logger = new Logger(OpenAIProvider.name);
  private client: OpenAI | null = null;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('OPENAI_API_KEY', '');
    if (apiKey) {
      this.client = new OpenAI({ apiKey, timeout: 300_000 });
      this.logger.log('OpenAI provider initialized');
    } else {
      this.logger.warn('OPENAI_API_KEY not set — OpenAI provider unavailable');
    }
  }

  isAvailable(): boolean {
    return !!this.client;
  }

  async generate(messages: LlmMessage[], options: LlmCallOptions): Promise<LlmResult> {
    if (!this.client) throw new Error('OpenAI provider not configured');

    const openaiMessages = this.toOpenAIFormat(messages, options);

    const response = await this.client.chat.completions.create({
      model: options.model,
      messages: openaiMessages,
      ...(options.generationConfig?.temperature !== undefined && {
        temperature: options.generationConfig.temperature,
      }),
      ...(options.generationConfig?.topP !== undefined && {
        top_p: options.generationConfig.topP,
      }),
      ...(options.generationConfig?.maxOutputTokens !== undefined && {
        max_tokens: options.generationConfig.maxOutputTokens,
      }),
    });

    const text = response.choices[0]?.message?.content || '';

    return {
      text,
      usage: {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
      },
    };
  }

  async stream(messages: LlmMessage[], options: LlmCallOptions): Promise<LlmStream> {
    if (!this.client) throw new Error('OpenAI provider not configured');

    const openaiMessages = this.toOpenAIFormat(messages, options);

    const streamResponse = await this.client.chat.completions.create({
      model: options.model,
      messages: openaiMessages,
      stream: true,
      stream_options: { include_usage: true },
      ...(options.generationConfig?.temperature !== undefined && {
        temperature: options.generationConfig.temperature,
      }),
      ...(options.generationConfig?.topP !== undefined && {
        top_p: options.generationConfig.topP,
      }),
      ...(options.generationConfig?.maxOutputTokens !== undefined && {
        max_tokens: options.generationConfig.maxOutputTokens,
      }),
    });

    let fullText = '';
    let usage: LlmResult['usage'] = {};

    const iterator = streamResponse[Symbol.asyncIterator]();

    const stream: LlmStream = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            const next = await iterator.next();
            if (next.done) return { done: true as const, value: '' };
            const chunk = next.value;
            const text = chunk.choices?.[0]?.delta?.content || '';
            if (chunk.usage) {
              usage = {
                promptTokens: chunk.usage.prompt_tokens,
                completionTokens: chunk.usage.completion_tokens,
              };
            }
            fullText += text;
            return { done: false, value: text };
          },
        };
      },
      async getResponse() {
        return { text: fullText, usage };
      },
    };

    return stream;
  }

  // ── Helpers ──

  private toOpenAIFormat(
    messages: LlmMessage[],
    options: LlmCallOptions,
  ): OpenAI.ChatCompletionMessageParam[] {
    const result: OpenAI.ChatCompletionMessageParam[] = [];

    // Add system prompt
    if (options.systemPrompt) {
      result.push({ role: 'system', content: options.systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        const text = msg.parts.filter((p) => p.text).map((p) => p.text!).join('\n');
        result.push({ role: 'system', content: text });
        continue;
      }

      const hasInlineData = msg.parts.some((p) => p.inlineData);

      if (hasInlineData) {
        // Use multimodal content format
        const content: OpenAI.ChatCompletionContentPart[] = msg.parts.map((p) =>
          this.toOpenAIPart(p),
        );
        result.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content,
        } as any);
      } else {
        const text = msg.parts.filter((p) => p.text).map((p) => p.text!).join('\n');
        result.push({
          role: msg.role === 'user' ? 'user' : 'assistant',
          content: text,
        });
      }
    }

    return result;
  }

  private toOpenAIPart(part: LlmContentPart): OpenAI.ChatCompletionContentPart {
    if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
      return {
        type: 'image_url',
        image_url: {
          url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
        },
      };
    }
    return { type: 'text', text: part.text || '' };
  }
}
