import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
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
export class AnthropicProvider implements ILlmProvider {
  readonly name: LlmProvider = 'anthropic';
  private readonly logger = new Logger(AnthropicProvider.name);
  private client: Anthropic | null = null;

  constructor(private readonly config: ConfigService) {
    const apiKey = config.get<string>('ANTHROPIC_API_KEY', '');
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
      this.logger.log('Anthropic provider initialized');
    } else {
      this.logger.warn('ANTHROPIC_API_KEY not set — Anthropic provider unavailable');
    }
  }

  isAvailable(): boolean {
    return !!this.client;
  }

  async generate(messages: LlmMessage[], options: LlmCallOptions): Promise<LlmResult> {
    if (!this.client) throw new Error('Anthropic provider not configured');

    const { system, anthropicMessages } = this.toAnthropicFormat(messages, options);

    const response = await this.client.messages.create({
      model: options.model,
      max_tokens: options.generationConfig?.maxOutputTokens || 4096,
      ...(system && { system }),
      ...(options.generationConfig?.temperature !== undefined && {
        temperature: options.generationConfig.temperature,
      }),
      ...(options.generationConfig?.topP !== undefined && {
        top_p: options.generationConfig.topP,
      }),
      ...(options.webSearch && {
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as any],
      }),
      messages: anthropicMessages,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return {
      text,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
      },
    };
  }

  async stream(messages: LlmMessage[], options: LlmCallOptions): Promise<LlmStream> {
    if (!this.client) throw new Error('Anthropic provider not configured');

    const { system, anthropicMessages } = this.toAnthropicFormat(messages, options);

    const streamResponse = this.client.messages.stream({
      model: options.model,
      max_tokens: options.generationConfig?.maxOutputTokens || 4096,
      ...(system && { system }),
      ...(options.generationConfig?.temperature !== undefined && {
        temperature: options.generationConfig.temperature,
      }),
      ...(options.generationConfig?.topP !== undefined && {
        top_p: options.generationConfig.topP,
      }),
      ...(options.webSearch && {
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 } as any],
      }),
      messages: anthropicMessages,
    });

    let fullText = '';

    const stream: LlmStream = {
      [Symbol.asyncIterator]() {
        const textStream = streamResponse.on('text', () => {});
        // Use the event-based text stream
        let started = false;
        return {
          async next() {
            if (!started) {
              started = true;
            }
            // Read text events via the async iterator on the stream
            // Anthropic SDK provides .on('text') events
            return { done: true as const, value: '' };
          },
        };
      },
      async getResponse() {
        // Collect all text from the stream
        const finalMessage = await streamResponse.finalMessage();
        fullText = finalMessage.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');
        return {
          text: fullText,
          usage: {
            promptTokens: finalMessage.usage.input_tokens,
            completionTokens: finalMessage.usage.output_tokens,
          },
        };
      },
    };

    // Better streaming: use the text stream properly
    const textEvents: string[] = [];
    let streamDone = false;
    let resolveNext: ((value: IteratorResult<string>) => void) | null = null;

    streamResponse.on('text', (text) => {
      fullText += text;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ done: false, value: text });
      } else {
        textEvents.push(text);
      }
    });

    streamResponse.on('end', () => {
      streamDone = true;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r({ done: true, value: '' });
      }
    });

    const properStream: LlmStream = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<string>> {
            if (textEvents.length > 0) {
              return Promise.resolve({ done: false, value: textEvents.shift()! });
            }
            if (streamDone) {
              return Promise.resolve({ done: true as const, value: '' });
            }
            return new Promise((resolve) => {
              resolveNext = resolve;
            });
          },
        };
      },
      async getResponse() {
        const finalMessage = await streamResponse.finalMessage();
        return {
          text: fullText,
          usage: {
            promptTokens: finalMessage.usage.input_tokens,
            completionTokens: finalMessage.usage.output_tokens,
          },
        };
      },
    };

    return properStream;
  }

  // ── Helpers ──

  private toAnthropicFormat(
    messages: LlmMessage[],
    options: LlmCallOptions,
  ): {
    system: string | undefined;
    anthropicMessages: Anthropic.MessageParam[];
  } {
    const systemParts: string[] = [];

    if (options.systemPrompt) {
      systemParts.push(options.systemPrompt);
    }

    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemParts.push(
          msg.parts
            .filter((p) => p.text)
            .map((p) => p.text!)
            .join('\n'),
        );
        continue;
      }

      const content = this.toAnthropicContent(msg.parts);
      anthropicMessages.push({
        role: msg.role === 'user' ? 'user' : 'assistant',
        content,
      });
    }

    return {
      system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
      anthropicMessages,
    };
  }

  private toAnthropicContent(
    parts: LlmContentPart[],
  ): Anthropic.ContentBlockParam[] {
    const blocks: Anthropic.ContentBlockParam[] = [];

    for (const part of parts) {
      if (part.inlineData) {
        // Anthropic supports images via base64
        if (part.inlineData.mimeType.startsWith('image/')) {
          blocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: part.inlineData.mimeType as
                | 'image/jpeg'
                | 'image/png'
                | 'image/gif'
                | 'image/webp',
              data: part.inlineData.data,
            },
          });
        } else if (part.inlineData.mimeType === 'application/pdf') {
          // Anthropic supports PDFs via document blocks
          blocks.push({
            type: 'document' as any,
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: part.inlineData.data,
            },
          } as any);
        } else {
          // For audio etc., include as text note (Anthropic doesn't support audio natively)
          blocks.push({
            type: 'text',
            text: `[Binary content: ${part.inlineData.mimeType}]`,
          });
        }
      } else if (part.text) {
        blocks.push({ type: 'text', text: part.text });
      }
    }

    return blocks.length > 0 ? blocks : [{ type: 'text', text: '' }];
  }
}
