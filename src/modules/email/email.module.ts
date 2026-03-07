import { Global, Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { EmailService } from './email.service';

@Global()
@Module({
  imports: [
    MailerModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.get<string>('SMTP_HOST'),
          port: config.get<number>('SMTP_PORT', 587),
          secure: config.get<number>('SMTP_PORT', 587) === 465,
          auth: {
            user: config.get<string>('SMTP_USER'),
            pass: config.get<string>('SMTP_PASS'),
          },
        },
        defaults: {
          from: config.get<string>('SMTP_FROM', '"Top Tutors" <no-reply@toptutors.com>'),
        },
        template: {
          dir:
            process.env.NODE_ENV === 'production'
              ? join(__dirname, 'templates')
              : join(process.cwd(), 'src', 'modules', 'email', 'templates'),
          adapter: new HandlebarsAdapter(),
          options: { strict: true },
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
