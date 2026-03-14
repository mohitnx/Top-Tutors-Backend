import { Injectable, Logger, NotFoundException, ForbiddenException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OcrService } from './ocr.service';
import { AnswerGenerationService } from './answer-generation.service';
import { PdfGenerationService } from './pdf-generation.service';
import { TtsService } from './tts.service';
import { Subject, UploadStatus } from '@prisma/client';

@Injectable()
export class DailyPackageService implements OnModuleInit {
  private readonly logger = new Logger(DailyPackageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
    private readonly answerGen: AnswerGenerationService,
    private readonly pdfGen: PdfGenerationService,
    private readonly tts: TtsService,
  ) {}

  /**
   * On server start, mark any stuck PENDING/PROCESSING uploads as FAILED
   * so teachers know to retry them.
   */
  async onModuleInit() {
    const stuck = await this.prisma.daily_uploads.updateMany({
      where: { status: { in: [UploadStatus.PENDING, UploadStatus.PROCESSING] } },
      data: { status: UploadStatus.FAILED, errorMsg: 'Server restarted during processing — please retry' },
    });
    if (stuck.count > 0) {
      this.logger.warn(`Marked ${stuck.count} stuck upload(s) as FAILED after server restart`);
    }
  }

  /**
   * Retry a failed upload by re-downloading images from storage and reprocessing.
   */
  async retryUpload(uploadId: string, userId: string, userRole: string, administeredSchoolId: string | null) {
    const upload = await this.prisma.daily_uploads.findUnique({
      where: { id: uploadId },
      include: {
        upload_images: { orderBy: { order: 'asc' } },
        class_sections: true,
      },
    });

    if (!upload) throw new NotFoundException('Upload not found');
    if (upload.status !== UploadStatus.FAILED) {
      throw new ForbiddenException('Only failed uploads can be retried');
    }

    // Verify access
    if (userRole === 'ADMINISTRATOR') {
      if (upload.class_sections.schoolId !== administeredSchoolId) {
        throw new ForbiddenException('Access denied');
      }
    } else {
      const teacher = await this.prisma.teachers.findUnique({ where: { userId } });
      if (!teacher || upload.teacherId !== teacher.id) {
        throw new ForbiddenException('Access denied');
      }
    }

    // Download images back from storage
    const imageBuffers = await Promise.all(
      upload.upload_images.map(async (img) => {
        const signedUrl = await this.storage.getSignedUrl(img.imageUrl);
        const response = await fetch(signedUrl);
        return Buffer.from(await response.arrayBuffer());
      }),
    );

    // Clean up old extracted questions and package if any
    await this.prisma.extracted_questions.deleteMany({ where: { uploadId } });
    await this.prisma.daily_packages.deleteMany({ where: { uploadId } });

    // Reset status and reprocess
    await this.prisma.daily_uploads.update({
      where: { id: uploadId },
      data: { status: UploadStatus.PENDING, errorMsg: null },
    });

    this.processUpload(uploadId, imageBuffers, upload.subject).catch((err) => {
      this.logger.error(`Retry processUpload failed for ${uploadId}: ${err.message}`);
    });

    return { uploadId, status: 'PENDING', message: 'Retry started' };
  }

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

  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }

  async processUpload(uploadId: string, imageBuffers: Buffer[], subject: Subject): Promise<void> {
    const t0 = Date.now();
    const cp = (step: string) => {
      const s = ((Date.now() - t0) / 1000).toFixed(1);
      this.logger.log(`[UPLOAD ${uploadId}] [${s}s] ${step}`);
    };

    try {
      cp('Step 1/8: Setting status to PROCESSING');
      await this.prisma.daily_uploads.update({
        where: { id: uploadId },
        data: { status: UploadStatus.PROCESSING },
      });

      cp(`Step 2/8: Starting OCR on ${imageBuffers.length} image(s)`);
      const rawQuestions = await this.withTimeout(
        this.ocr.extractQuestions(imageBuffers),
        240_000,
        'OCR extraction',
      );
      cp(`Step 2/8: OCR complete — ${rawQuestions.length} raw question(s)`);

      if (rawQuestions.length === 0) {
        throw new Error('OCR extracted 0 questions — ensure images contain readable text');
      }

      cp(`Step 3/8: Starting ranking & answer generation for ${rawQuestions.length} question(s)`);
      const answeredQuestions = await this.withTimeout(
        this.answerGen.rankAndAnswer(rawQuestions, subject),
        360_000,
        'Rank & Answer generation',
      );
      cp(`Step 3/8: Ranking complete — ${answeredQuestions.length} answered question(s)`);

      cp('Step 4/8: Saving questions to database');
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
      cp('Step 4/8: Questions saved');

      const upload = await this.prisma.daily_uploads.findUnique({ where: { id: uploadId } });
      const now = new Date();

      cp('Step 5/8: Generating PDF');
      const pdfBuffer = await this.withTimeout(
        this.pdfGen.generateDailyPdf(answeredQuestions, subject, now),
        60_000,
        'PDF generation',
      );
      cp(`Step 5/8: PDF generated (${(pdfBuffer.length / 1024).toFixed(1)} KB)`);

      cp('Step 6/8: Uploading PDF to storage');
      const pdfKey = `packages/${uploadId}/daily.pdf`;
      const pdfUrl = await this.withTimeout(
        this.storage.uploadBuffer(pdfKey, pdfBuffer, 'application/pdf'),
        60_000,
        'PDF upload',
      );
      cp('Step 6/8: PDF uploaded');

      cp('Step 7/8: Generating audio (TTS)');
      let audioUrl: string | undefined;
      try {
        const audioBuffer = await this.withTimeout(
          this.tts.generateAudio(answeredQuestions, subject, now),
          120_000,
          'TTS audio generation',
        );
        if (audioBuffer) {
          const audioKey = `packages/${uploadId}/daily.mp3`;
          audioUrl = await this.storage.uploadBuffer(audioKey, audioBuffer, 'audio/mpeg');
          cp(`Step 7/8: Audio generated (${(audioBuffer.length / 1024).toFixed(1)} KB)`);
        } else {
          cp('Step 7/8: TTS not configured — skipped');
        }
      } catch (ttsErr) {
        cp(`Step 7/8: TTS failed (non-fatal): ${ttsErr.message}`);
      }

      const quizJson = answeredQuestions.map((q, i) => ({
        id: i + 1,
        question: q.text,
        answer: q.shortAnswer,
      }));

      cp('Step 8/8: Creating daily package record');
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

      cp('COMPLETE — all steps finished');
    } catch (err) {
      const s = ((Date.now() - t0) / 1000).toFixed(1);
      this.logger.error(`[UPLOAD ${uploadId}] [${s}s] FAILED: ${err.message}`);
      this.logger.error(`[UPLOAD ${uploadId}] Stack: ${err.stack}`);
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
