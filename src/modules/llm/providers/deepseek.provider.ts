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

/**
 * DeepSeek uses the OpenAI-compatible API, so we reuse the OpenAI SDK
 * with a custom baseURL.
 */
@Injectable()
export class DeepSeekProvider implements ILlmProvider {
  readonly name: LlmProvider = 'deepseek';
  private readonly logger = new Logger(DeepSeekProvider.name);
  private client: OpenAI | null = null;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('DEEPSEEK_API_KEY', '');
    if (apiKey) {
      this.client = new OpenAI({
        apiKey,
        baseURL: 'https://api.deepseek.com',
      });
      this.logger.log('DeepSeek provider initialized');
    } else {
      this.logger.warn('DEEPSEEK_API_KEY not set — DeepSeek provider unavailable');
    }
  }

  isAvailable(): boolean {
    return !!this.client;
  }

  async generate(messages: LlmMessage[], options: LlmCallOptions): Promise<LlmResult> {
    if (!this.client) throw new Error('DeepSeek provider not configured');

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

    return {
      text: response.choices[0]?.message?.content || '',
      usage: {
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
      },
    };
  }

  async stream(messages: LlmMessage[], options: LlmCallOptions): Promise<LlmStream> {
    if (!this.client) throw new Error('DeepSeek provider not configured');

    const openaiMessages = this.toOpenAIFormat(messages, options);

    const streamResponse = await this.client.chat.completions.create({
      model: options.model,
      messages: openaiMessages,
      stream: true,
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
            const text = next.value.choices?.[0]?.delta?.content || '';
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

    if (options.systemPrompt) {
      result.push({ role: 'system', content: options.systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === 'system') {
        const text = msg.parts.filter((p) => p.text).map((p) => p.text!).join('\n');
        result.push({ role: 'system', content: text });
        continue;
      }

      // DeepSeek is text-only (no vision), so extract text parts only
      const text = msg.parts
        .filter((p) => p.text)
        .map((p) => p.text!)
        .join('\n');

      result.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content: text,
      });
    }

    return result;
  }
}
