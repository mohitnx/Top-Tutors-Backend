import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { MessagesGateway } from './messages.gateway';
import { TutorMatchingService } from './tutor-matching.service';
import { AiModule } from '../ai';

@Module({
  imports: [
    AiModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [MessagesController],
  providers: [MessagesService, MessagesGateway, TutorMatchingService],
  exports: [MessagesService, MessagesGateway],
})
export class MessagesModule {}

