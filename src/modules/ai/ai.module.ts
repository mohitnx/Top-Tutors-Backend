import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SystemInstructionsService } from './system-instructions/system-instructions.service';

@Module({
  imports: [ConfigModule],
  providers: [SystemInstructionsService],
  exports: [SystemInstructionsService],
})
export class AiModule {}

