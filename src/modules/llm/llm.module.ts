import { Global, Module } from '@nestjs/common';
import { LlmService } from './llm.service';
import { GeminiProvider } from './providers/gemini.provider';
import { VertexProvider } from './providers/vertex.provider';
import { AnthropicProvider } from './providers/anthropic.provider';
import { OpenAIProvider } from './providers/openai.provider';
import { DeepSeekProvider } from './providers/deepseek.provider';

@Global()
@Module({
  providers: [
    GeminiProvider,
    VertexProvider,
    AnthropicProvider,
    OpenAIProvider,
    DeepSeekProvider,
    LlmService,
  ],
  exports: [LlmService],
})
export class LlmModule {}
