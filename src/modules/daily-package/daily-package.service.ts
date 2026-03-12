import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OcrService } from './ocr.service';
import { AnswerGenerationService } from './answer-generation.service';
import { PdfGenerationService } from './pdf-generation.service';
import { TtsService } from './tts.service';
import { Subject, UploadStatus } from '@prisma/client';

@Injectable()
export class DailyPackageService {
  private readonly logger = new Logger(DailyPackageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
    private readonly answerGen: AnswerGenerationService,
    private readonly pdfGen: PdfGenerationService,
    private readonly tts: TtsService,
  ) {}

  async createUpload(
    userId: string,
    userRole: string,
    administeredSchoolId: string | null,
    sectionId: string,
    subject: Subject,
    imageBuffers: Buffer[],
  ): Promise<{ uploadId: string; status: string }> {
    let teacherId: string | null = null;

    if (userRole === 'ADMINISTRATOR') {
      // Administrator: verify section belongs to their school
      if (!administeredSchoolId) {
        throw new ForbiddenException('No school associated with this administrator');
      }
      const section = await this.prisma.class_sections.findUnique({ where: { id: sectionId } });
      if (!section || section.schoolId !== administeredSchoolId) {
        throw new ForbiddenException('This section does not belong to your school');
      }
    } else {
      // Teacher: verify teacher profile and section assignment
      const teacher = await this.prisma.teachers.findUnique({ where: { userId } });
      if (!teacher) throw new NotFoundException('Teacher profile not found');

      const assignment = await this.prisma.teacher_sections.findFirst({
        where: { teacherId: teacher.id, sectionId, subject },
      });
      if (!assignment) {
        throw new ForbiddenException('You are not assigned to this section for this subject');
      }
      teacherId = teacher.id;
    }

    // Create upload record
    const upload = await this.prisma.daily_uploads.create({
      data: {
        teacherId,
        uploadedByUserId: userId,
        sectionId,
        subject,
        status: UploadStatus.PENDING,
      },
    });

    // Upload images to S3 and create image records
    try {
      const imageRecords = await Promise.all(
        imageBuffers.map(async (buf, i) => {
          const key = `uploads/${upload.id}/${i}.jpg`;
          const url = await this.storage.uploadBuffer(key, buf, 'image/jpeg');
          return { uploadId: upload.id, imageUrl: url, order: i };
        }),
      );

      await this.prisma.upload_images.createMany({ data: imageRecords });
    } catch (err) {
      this.logger.error(`Image upload to S3 failed for ${upload.id}: ${err.message}`);
      await this.prisma.daily_uploads.update({
        where: { id: upload.id },
        data: { status: UploadStatus.FAILED, errorMsg: `Image upload failed: ${err.message}` },
      });
      throw new Error(`Failed to upload images to storage: ${err.message}`);
    }

    // Fire-and-forget processing
    this.processUpload(upload.id, imageBuffers, subject).catch((err) => {
      this.logger.error(`processUpload failed for ${upload.id}: ${err.message}`);
    });

    return { uploadId: upload.id, status: 'PENDING' };
  }

  async processUpload(uploadId: string, imageBuffers: Buffer[], subject: Subject): Promise<void> {
    try {
      await this.prisma.daily_uploads.update({
        where: { id: uploadId },
        data: { status: UploadStatus.PROCESSING },
      });

      // 1. OCR (Gemini Flash — extracts text from handwritten images)
      const rawQuestions = await this.ocr.extractQuestions(imageBuffers);
      this.logger.log(`OCR extracted ${rawQuestions.length} raw questions for upload ${uploadId}`);

      // 2. Rank + Answer in single SOTA call (Gemini 2.5 Flash)
      //    Groups similar questions semantically, ranks Most Asked / Best Asked,
      //    and generates structured answers — all in one LLM call.
      const answeredQuestions = await this.answerGen.rankAndAnswer(rawQuestions, subject);

      // 3. Persist questions to DB
      await this.prisma.extracted_questions.createMany({
        data: answeredQuestions.map((q) => ({
          uploadId,
          text: q.text,
          frequency: q.frequency,
          rankType: q.rankType ?? null,
          rankPosition: q.rankPosition ?? null,
          shortAnswer: q.shortAnswer,
          fullAnswer: q.fullAnswer,
          realLifeExample: q.realLifeExample,
        })),
      });

      const upload = await this.prisma.daily_uploads.findUnique({ where: { id: uploadId } });
      const now = new Date();

      // 5. Generate PDF
      const pdfBuffer = await this.pdfGen.generateDailyPdf(answeredQuestions, subject, now);
      const pdfKey = `packages/${uploadId}/daily.pdf`;
      const pdfUrl = await this.storage.uploadBuffer(pdfKey, pdfBuffer, 'application/pdf');

      // 6. Generate audio (optional)
      const audioBuffer = await this.tts.generateAudio(answeredQuestions, subject, now);
      let audioUrl: string | undefined;
      if (audioBuffer) {
        const audioKey = `packages/${uploadId}/daily.mp3`;
        audioUrl = await this.storage.uploadBuffer(audioKey, audioBuffer, 'audio/mpeg');
      }

      // 7. Build quiz JSON
      const quizJson = answeredQuestions.map((q, i) => ({
        id: i + 1,
        question: q.text,
        answer: q.shortAnswer,
      }));

      // 8. Create daily_packages record
      await this.prisma.daily_packages.create({
        data: {
          uploadId,
          sectionId: upload!.sectionId,
          subject,
          packageDate: now,
          pdfUrl,
          audioUrl,
          quizJson,
          summaryText: `${answeredQuestions.length} questions answered for ${subject} on ${now.toDateString()}`,
        },
      });

      await this.prisma.daily_uploads.update({
        where: { id: uploadId },
        data: { status: UploadStatus.COMPLETE },
      });

      this.logger.log(`Daily package processing complete for upload ${uploadId}`);
    } catch (err) {
      this.logger.error(`Processing failed for upload ${uploadId}: ${err.message}`);
      await this.prisma.daily_uploads.update({
        where: { id: uploadId },
        data: { status: UploadStatus.FAILED, errorMsg: err.message },
      });
    }
  }

  async getStudentPackages(userId: string, type: 'daily' | 'weekly') {
    const student = await this.prisma.students.findUnique({ where: { userId } });
    if (!student) throw new NotFoundException('Student profile not found');

    const sectionIds = (
      await this.prisma.student_sections.findMany({
        where: { studentId: student.id },
        select: { sectionId: true },
      })
    ).map((s) => s.sectionId);

    if (type === 'daily') {
      return this.prisma.daily_packages.findMany({
        where: { sectionId: { in: sectionIds }, pdfUrl: { not: null } },
        orderBy: { packageDate: 'desc' },
        take: 30,
      });
    }

    return this.prisma.weekly_packages.findMany({
      where: { sectionId: { in: sectionIds }, pdfUrl: { not: null } },
      orderBy: { weekStart: 'desc' },
      take: 20,
    });
  }

  async getPackageDownloadUrl(packageId: string, userId: string): Promise<string> {
    const pkg = await this.prisma.daily_packages.findUnique({ where: { id: packageId } });
    if (!pkg || !pkg.pdfUrl) throw new NotFoundException('Package not found');

    // Verify student has access via section membership
    const student = await this.prisma.students.findUnique({ where: { userId } });
    if (student) {
      const membership = await this.prisma.student_sections.findFirst({
        where: { studentId: student.id, sectionId: pkg.sectionId },
      });
      if (!membership) throw new ForbiddenException('Access denied');
    }

    // Extract the R2 key from the URL or use the pdfUrl directly
    const key = pkg.pdfUrl.startsWith('packages/') ? pkg.pdfUrl : `packages/${packageId}/daily.pdf`;
    return this.storage.getSignedUrl(key);
  }

  async getUploads(userId: string, userRole: string, administeredSchoolId: string | null) {
    let where: any;

    if (userRole === 'ADMINISTRATOR') {
      if (!administeredSchoolId) {
        throw new ForbiddenException('No school associated with this administrator');
      }
      // Show all uploads for sections in the administrator's school
      const schoolSections = await this.prisma.class_sections.findMany({
        where: { schoolId: administeredSchoolId },
        select: { id: true },
      });
      where = { sectionId: { in: schoolSections.map((s) => s.id) } };
    } else {
      const teacher = await this.prisma.teachers.findUnique({ where: { userId } });
      if (!teacher) throw new NotFoundException('Teacher profile not found');
      where = { teacherId: teacher.id };
    }

    return this.prisma.daily_uploads.findMany({
      where,
      include: {
        class_sections: { select: { id: true, name: true, grade: true } },
        daily_packages: { select: { id: true, pdfUrl: true, audioUrl: true, packageDate: true } },
        uploadedByUser: { select: { id: true, name: true, role: true } },
        _count: { select: { upload_images: true, extracted_questions: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async getUploadDetails(uploadId: string, userId: string, userRole: string, administeredSchoolId: string | null) {
    const upload = await this.prisma.daily_uploads.findUnique({
      where: { id: uploadId },
      include: {
        class_sections: { select: { id: true, name: true, grade: true, schoolId: true } },
        upload_images: { select: { imageUrl: true, order: true } },
        extracted_questions: {
          select: { text: true, frequency: true, rankType: true, rankPosition: true, shortAnswer: true },
          orderBy: { rankPosition: 'asc' },
        },
        daily_packages: { select: { id: true, pdfUrl: true, audioUrl: true, quizJson: true, packageDate: true } },
        uploadedByUser: { select: { id: true, name: true, role: true } },
      },
    });

    if (!upload) throw new NotFoundException('Upload not found');

    if (userRole === 'ADMINISTRATOR') {
      if (upload.class_sections.schoolId !== administeredSchoolId) {
        throw new ForbiddenException('Access denied');
      }
    } else {
      const teacher = await this.prisma.teachers.findUnique({ where: { userId } });
      if (!teacher) throw new NotFoundException('Teacher profile not found');
      if (upload.teacherId !== teacher.id) throw new ForbiddenException('Access denied');
    }

    return upload;
  }
}
