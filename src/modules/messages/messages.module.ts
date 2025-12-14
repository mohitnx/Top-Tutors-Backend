import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';
import { TutorNotificationService } from './tutor-notification.service';
import { WaitingQueueService } from './waiting-queue.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule, // For JwtService
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit for audio files
      },
    }),
  ],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesGateway, TutorNotificationService, WaitingQueueService],
  exports: [MessagesService, MessagesGateway, TutorNotificationService, WaitingQueueService],
})
export class MessagesModule {}
