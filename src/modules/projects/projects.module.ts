import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectChatService } from './project-chat.service';
import { ProjectsGateway } from './projects.gateway';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    AuthModule,
    AiModule,
    MulterModule.register({
      limits: {
        fileSize: 20 * 1024 * 1024, // 20MB max file size
      },
    }),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectChatService, ProjectsGateway],
  exports: [ProjectsService, ProjectChatService],
})
export class ProjectsModule {}
