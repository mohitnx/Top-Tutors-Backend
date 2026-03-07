import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { Role, Subject } from '@prisma/client';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private readonly mailer: MailerService,
    private readonly config: ConfigService,
  ) {}

  async sendInvitation(to: string, name: string, token: string, role: Role): Promise<void> {
    const frontendUrl = this.config.get<string>('FRONTEND_URL', 'http://localhost:5173');
    const invitationUrl = `${frontendUrl}/accept-invitation?token=${token}`;

    const roleLabel: Record<Role, string> = {
      [Role.ADMIN]: 'Administrator',
      [Role.ADMINISTRATOR]: 'School Administrator',
      [Role.TEACHER]: 'Teacher',
      [Role.TUTOR]: 'Tutor',
      [Role.STUDENT]: 'Student',
    };

    try {
      await this.mailer.sendMail({
        to,
        subject: "You're invited to Top Tutors",
        template: 'invitation',
        context: {
          name,
          role: roleLabel[role] ?? role,
          invitationUrl,
        },
      });
      this.logger.log(`Invitation email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send invitation email to ${to}: ${error.message}`);
    }
  }

  async sendDailyPackage(
    to: string,
    name: string,
    packageDate: Date,
    subject: Subject,
    pdfUrl: string,
  ): Promise<void> {
    const dateStr = packageDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    try {
      await this.mailer.sendMail({
        to,
        subject: `Your ${subject} Daily Learning Package — ${dateStr}`,
        template: 'daily-package',
        context: { name, subject, dateStr, pdfUrl },
      });
      this.logger.log(`Daily package email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send daily package email to ${to}: ${error.message}`);
    }
  }

  async sendWeeklyPackage(
    to: string,
    name: string,
    weekRange: string,
    subject: Subject,
    pdfUrl: string,
  ): Promise<void> {
    try {
      await this.mailer.sendMail({
        to,
        subject: `Your ${subject} Weekly Learning Package — ${weekRange}`,
        template: 'weekly-package',
        context: { name, subject, weekRange, pdfUrl },
      });
      this.logger.log(`Weekly package email sent to ${to}`);
    } catch (error) {
      this.logger.error(`Failed to send weekly package email to ${to}: ${error.message}`);
    }
  }
}
