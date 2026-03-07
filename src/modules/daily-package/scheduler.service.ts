import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { StorageService } from '../storage/storage.service';
import { PdfGenerationService } from './pdf-generation.service';
import { Subject } from '@prisma/client';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly storage: StorageService,
    private readonly pdfGen: PdfGenerationService,
  ) {}

  /**
   * Runs nightly at 10 PM PKT (17:00 UTC).
   * Finds all completed daily packages not yet emailed and sends them to section students.
   */
  @Cron('0 17 * * *')
  async sendDailyPackages(): Promise<void> {
    this.logger.log('Running nightly daily package distribution...');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const packages = await this.prisma.daily_packages.findMany({
      where: {
        emailSentAt: null,
        pdfUrl: { not: null },
        packageDate: { gte: today, lt: tomorrow },
      },
      include: {
        daily_uploads: {
          include: {
            class_sections: {
              include: {
                student_sections: {
                  include: {
                    students: { include: { users: { select: { name: true, email: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    });

    this.logger.log(`Found ${packages.length} packages to distribute`);

    for (const pkg of packages) {
      const students = pkg.daily_uploads.class_sections.student_sections.map((ss) => ss.students.users);

      for (const student of students) {
        try {
          await this.emailService.sendDailyPackage(
            student.email,
            student.name,
            pkg.packageDate,
            pkg.subject as Subject,
            pkg.pdfUrl!,
          );
        } catch (err) {
          this.logger.error(`Failed to email daily package to ${student.email}: ${err.message}`);
        }
      }

      await this.prisma.daily_packages.update({
        where: { id: pkg.id },
        data: { emailSentAt: new Date() },
      });

      this.logger.log(`Emailed daily package ${pkg.id} to ${students.length} students`);
    }
  }

  /**
   * Runs Saturday morning at 8 AM PKT (3:00 UTC).
   * Combines the week's daily packages into a weekly PDF per section per subject.
   */
  @Cron('0 3 * * 6')
  async sendWeeklyPackages(): Promise<void> {
    this.logger.log('Running weekly package generation...');

    const now = new Date();
    const weekEnd = new Date(now);
    weekEnd.setHours(0, 0, 0, 0);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekEnd.getDate() - 5); // Mon-Fri

    // Find all sections that have daily packages this week
    const dailyPackages = await this.prisma.daily_packages.findMany({
      where: {
        packageDate: { gte: weekStart, lt: weekEnd },
        pdfUrl: { not: null },
        weeklyPackageId: null, // not yet aggregated
      },
    });

    // Group by sectionId + subject
    const groups = new Map<string, typeof dailyPackages>();
    for (const pkg of dailyPackages) {
      const key = `${pkg.sectionId}::${pkg.subject}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(pkg);
    }

    for (const [key, pkgs] of groups.entries()) {
      if (pkgs.length === 0) continue;
      const [sectionId, subject] = key.split('::');

      try {
        // Generate weekly summary PDF
        const weeklyPdf = await this.pdfGen.mergePdfs([]);
        const pdfKey = `packages/weekly/${sectionId}/${subject}/${weekStart.toISOString().slice(0, 10)}.pdf`;
        const pdfUrl = await this.storage.uploadBuffer(pdfKey, weeklyPdf, 'application/pdf');

        const weekly = await this.prisma.weekly_packages.create({
          data: { sectionId, subject: subject as Subject, weekStart, weekEnd, pdfUrl },
        });

        // Link daily packages to this weekly
        await this.prisma.daily_packages.updateMany({
          where: { id: { in: pkgs.map((p) => p.id) } },
          data: { weeklyPackageId: weekly.id },
        });

        // Email to section students
        const section = await this.prisma.class_sections.findUnique({
          where: { id: sectionId },
          include: {
            student_sections: {
              include: { students: { include: { users: { select: { name: true, email: true } } } } },
            },
          },
        });

        if (section) {
          const weekRange = `${weekStart.toLocaleDateString()} - ${weekEnd.toLocaleDateString()}`;
          for (const ss of section.student_sections) {
            const student = ss.students.users;
            try {
              await this.emailService.sendWeeklyPackage(
                student.email,
                student.name,
                weekRange,
                subject as Subject,
                pdfUrl,
              );
            } catch (err) {
              this.logger.error(`Failed weekly email to ${student.email}: ${err.message}`);
            }
          }

          await this.prisma.weekly_packages.update({
            where: { id: weekly.id },
            data: { emailSentAt: new Date() },
          });
        }

        this.logger.log(`Weekly package created for section ${sectionId} subject ${subject}`);
      } catch (err) {
        this.logger.error(`Weekly package generation failed for ${key}: ${err.message}`);
      }
    }
  }
}
