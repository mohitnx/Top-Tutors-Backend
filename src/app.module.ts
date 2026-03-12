import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { WinstonModule } from 'nest-winston';
import { ScheduleModule } from '@nestjs/schedule';
import * as winston from 'winston';

// Config
import appConfig from './config/app.config';
import databaseConfig from './config/database.config';

// Modules
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { AuthModule } from './modules/auth/auth.module';
import { MessagesModule } from './modules/messages/messages.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { GeminiChatModule } from './modules/gemini-chat/gemini-chat.module';
import { EmailModule } from './modules/email/email.module';
import { SchoolsModule } from './modules/schools/schools.module';
import { StorageModule } from './modules/storage/storage.module';
import { TeachersModule } from './modules/teachers/teachers.module';
import { ClassSectionsModule } from './modules/class-sections/class-sections.module';
import { DailyPackageModule } from './modules/daily-package/daily-package.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { PromptsModule } from './modules/prompts/prompts.module';
import { LlmModule } from './modules/llm/llm.module';

// Common
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig],
      envFilePath: ['.env', '.env.local'],
    }),

    // Winston Logger
    WinstonModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        transports: [
          new winston.transports.Console({
            level: configService.get<string>('LOG_LEVEL', 'info'),
            format: winston.format.combine(
              winston.format.timestamp(),
              winston.format.colorize(),
              winston.format.printf(({ timestamp, level, message, context, trace }) => {
                return `${timestamp} [${context || 'Application'}] ${level}: ${message}${trace ? `\n${trace}` : ''}`;
              }),
            ),
          }),
          // File transport for production
          ...(configService.get('NODE_ENV') === 'production'
            ? [
                new winston.transports.File({
                  filename: 'logs/error.log',
                  level: 'error',
                  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
                }),
                new winston.transports.File({
                  filename: 'logs/combined.log',
                  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
                }),
              ]
            : []),
        ],
      }),
      inject: [ConfigService],
    }),

    // Rate limiting
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('THROTTLE_TTL', 60) * 1000,
          limit: config.get<number>('THROTTLE_LIMIT', 100),
        },
      ],
    }),

    // Scheduler (cron jobs)
    ScheduleModule.forRoot(),

    // Database
    PrismaModule,

    // Prompt registry (global)
    PromptsModule,

    // LLM providers (global — Gemini, Anthropic, OpenAI, DeepSeek)
    LlmModule,

    // Feature modules
    StorageModule,
    EmailModule,
    HealthModule,
    UsersModule,
    AuthModule,
    SchoolsModule,
    TeachersModule,
    ClassSectionsModule,
    MessagesModule,
    ProfilesModule,
    GeminiChatModule,
    DailyPackageModule,
    ProjectsModule,
  ],
  providers: [
    // Global exception filter
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Global response transformer
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    // Global logging interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // Global throttler guard
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

