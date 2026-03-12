import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PromptService } from './prompt.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [PromptService],
  exports: [PromptService],
})
export class PromptsModule {}
