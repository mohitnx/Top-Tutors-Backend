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
      this.client = new Anthropic({ apiKey, timeout: 300_000 }); // 5 min request timeout
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

    const tools: any[] = [];
    if (options.webSearch) {
      tools.push({
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: options.maxWebSearches || 3,
      });
    }

    // Anthropic requires max_tokens > thinking.budget_tokens, capped at 64000
    const MAX_ANTHROPIC_TOKENS = 64000;
    const baseMaxTokens = options.generationConfig?.maxOutputTokens || 4096;
    const thinkingEnabled = options.thinkingBudget && options.thinkingBudget > 0;
    const maxTokens = thinkingEnabled
      ? Math.min(baseMaxTokens + options.thinkingBudget!, MAX_ANTHROPIC_TOKENS)
      : baseMaxTokens;

    // Anthropic does not allow both temperature and top_p at the same time
    const hasTopP = options.generationConfig?.topP !== undefined;
    const hasTemp = options.generationConfig?.temperature !== undefined && !thinkingEnabled;

    const response = await this.client.messages.create({
      model: options.model,
      max_tokens: maxTokens,
      ...(system && { system }),
      ...(hasTemp && !hasTopP && {
        temperature: options.generationConfig!.temperature,
      }),
      ...(hasTopP && {
        top_p: options.generationConfig!.topP,
      }),
      ...(tools.length > 0 && { tools }),
      // Extended thinking: real chain-of-thought with thinking budget
      ...(thinkingEnabled && {
        thinking: { type: 'enabled', budget_tokens: options.thinkingBudget },
        temperature: 1,
      }),
      messages: anthropicMessages,
    } as any);

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

    const streamTools: any[] = [];
    if (options.webSearch) {
      streamTools.push({
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: options.maxWebSearches || 3,
      });
    }

    // Anthropic requires max_tokens > thinking.budget_tokens, capped at 64000
    const MAX_STREAM_TOKENS = 64000;
    const streamBaseMaxTokens = options.generationConfig?.maxOutputTokens || 4096;
    const streamThinkingEnabled = options.thinkingBudget && options.thinkingBudget > 0;
    const streamMaxTokens = streamThinkingEnabled
      ? Math.min(streamBaseMaxTokens + options.thinkingBudget!, MAX_STREAM_TOKENS)
      : streamBaseMaxTokens;

    // Anthropic does not allow both temperature and top_p at the same time
    const streamHasTopP = options.generationConfig?.topP !== undefined;
    const streamHasTemp = options.generationConfig?.temperature !== undefined && !streamThinkingEnabled;

    const streamResponse = this.client.messages.stream({
      model: options.model,
      max_tokens: streamMaxTokens,
      ...(system && { system }),
      ...(streamHasTemp && !streamHasTopP && {
        temperature: options.generationConfig!.temperature,
      }),
      ...(streamHasTopP && {
        top_p: options.generationConfig!.topP,
      }),
      ...(streamTools.length > 0 && { tools: streamTools }),
      // Extended thinking: real chain-of-thought with thinking budget
      ...(streamThinkingEnabled && {
        thinking: { type: 'enabled', budget_tokens: options.thinkingBudget },
        temperature: 1,
      }),
      messages: anthropicMessages,
    } as any);

    let fullText = '';
    const textEvents: string[] = [];
    let streamDone = false;
    let streamError: Error | null = null;
    let resolveNext: ((value: IteratorResult<string>) => void) | null = null;
    let rejectNext: ((err: Error) => void) | null = null;

    streamResponse.on('text', (text) => {
      fullText += text;
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        rejectNext = null;
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
        rejectNext = null;
        r({ done: true, value: '' });
      }
    });

    streamResponse.on('error', (err: Error) => {
      streamDone = true;
      streamError = err;
      if (rejectNext) {
        const r = rejectNext;
        resolveNext = null;
        rejectNext = null;
        r(err);
      }
    });

    const resultStream: LlmStream = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<string>> {
            if (textEvents.length > 0) {
              return Promise.resolve({ done: false, value: textEvents.shift()! });
            }
            if (streamError) {
              return Promise.reject(streamError);
            }
            if (streamDone) {
              return Promise.resolve({ done: true as const, value: '' });
            }
            return new Promise((resolve, reject) => {
              resolveNext = resolve;
              rejectNext = reject;
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

    return resultStream;
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
      // Skip messages that resolved to only empty text blocks
      const hasReal = content.some(
        (b) => b.type !== 'text' || ('text' in b && b.text && b.text !== '(empty)'),
      );
      if (!hasReal) continue;
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

    return blocks.length > 0 ? blocks : [{ type: 'text', text: '(empty)' }];
  }
}
