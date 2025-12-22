import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { GeminiChatController } from './gemini-chat.controller';
import { GeminiChatService } from './gemini-chat.service';
import { GeminiChatGateway } from './gemini-chat.gateway';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    forwardRef(() => MessagesModule), // For tutor notification integration
    MulterModule.register({
      limits: {
        fileSize: 25 * 1024 * 1024, // 25MB max file size
      },
    }),
  ],
  controllers: [GeminiChatController],
  providers: [GeminiChatService, GeminiChatGateway],
  exports: [GeminiChatService, GeminiChatGateway],
})
export class GeminiChatModule {}

