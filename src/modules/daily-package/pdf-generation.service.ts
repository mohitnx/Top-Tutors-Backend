import { Injectable, Logger } from '@nestjs/common';
import { Subject } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import { AnsweredQuestion } from './answer-generation.service';

export interface DayQuestions {
  date: Date;
  questions: AnsweredQuestion[];
}

@Injectable()
export class PdfGenerationService {
  private readonly logger = new Logger(PdfGenerationService.name);

  async generateDailyPdf(
    questions: AnsweredQuestion[],
    subject: Subject,
    date: Date,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const dateStr = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

      // ─── Cover ──────────────────────────────────────────────────────────────
      doc.fontSize(24).font('Helvetica-Bold').text('Daily Learning Package', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(16).font('Helvetica').text(`${subject} — ${dateStr}`, { align: 'center' });
      doc.moveDown(2);
      doc.fontSize(12).text(`This package contains ${questions.length} key questions from today's class, with model answers.`, { align: 'center' });
      doc.moveDown(3);

      // ─── Q&A Section ────────────────────────────────────────────────────────
      doc.fontSize(18).font('Helvetica-Bold').text('Questions & Answers');
      doc.moveDown(1);
      this.renderQuestions(doc, questions);

      // ─── Quiz Section ────────────────────────────────────────────────────────
      doc.addPage();
      this.renderQuiz(doc, questions);

      doc.end();
    });
  }

  async generateWeeklyPdf(
    questionsByDay: DayQuestions[],
    subject: Subject,
    weekStart: Date,
    weekEnd: Date,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      const totalQuestions = questionsByDay.reduce((sum, d) => sum + d.questions.length, 0);

      // ─── Cover ──────────────────────────────────────────────────────────────
      doc.fontSize(24).font('Helvetica-Bold').text('Weekly Learning Package', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(16).font('Helvetica').text(`${subject} — ${fmt(weekStart)} to ${fmt(weekEnd)}`, { align: 'center' });
      doc.moveDown(2);
      doc.fontSize(12).text(
        `This package combines ${totalQuestions} questions from ${questionsByDay.length} day(s) of class this week.`,
        { align: 'center' },
      );
      doc.moveDown(3);

      // ─── Per-day Q&A ────────────────────────────────────────────────────────
      for (const day of questionsByDay) {
        const dayStr = day.date.toLocaleDateString('en-US', {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
        });

        doc.fontSize(18).font('Helvetica-Bold').text(dayStr);
        doc.moveDown(0.3);
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#333333').lineWidth(1).stroke();
        doc.lineWidth(1);
        doc.moveDown(0.8);

        this.renderQuestions(doc, day.questions);
        doc.moveDown(1);
      }

      // ─── Combined Quiz ──────────────────────────────────────────────────────
      const allQuestions = questionsByDay.flatMap((d) => d.questions);
      doc.addPage();
      this.renderQuiz(doc, allQuestions);

      doc.end();
    });
  }

  private renderQuestions(doc: any, questions: AnsweredQuestion[]): void {
    questions.forEach((q, i) => {
      const tag =
        q.rankType === 'MOST_ASKED'
          ? ' [Most Asked]'
          : q.rankType === 'BEST_ASKED'
            ? ' [Best Asked]'
            : '';
      doc.fontSize(13).font('Helvetica-Bold').text(`Q${i + 1}.${tag} ${q.text}`);
      doc.moveDown(0.3);

      if (q.frequency > 1) {
        doc.fontSize(10).font('Helvetica-Oblique').fillColor('#666666').text(`Asked by ${q.frequency} students`);
        doc.fillColor('#000000');
        doc.moveDown(0.2);
      }

      if (q.similarQuestions && q.similarQuestions.length > 0) {
        doc.fontSize(9).font('Helvetica-Oblique').fillColor('#888888')
          .text(`Similar wordings: ${q.similarQuestions.slice(0, 3).join('; ')}`);
        doc.fillColor('#000000');
        doc.moveDown(0.2);
      }

      if (q.shortAnswer) {
        doc.fontSize(11).font('Helvetica-Bold').text('Quick Answer:');
        doc.fontSize(11).font('Helvetica').text(q.shortAnswer);
        doc.moveDown(0.3);
      }

      if (q.fullAnswer) {
        doc.fontSize(11).font('Helvetica-Bold').text('Detailed Explanation:');
        doc.fontSize(11).font('Helvetica').text(q.fullAnswer);
        doc.moveDown(0.3);
      }

      if (q.realLifeExample) {
        doc.fontSize(11).font('Helvetica-Bold').text('Real-Life Application:');
        doc.fontSize(11).font('Helvetica').text(q.realLifeExample);
        doc.moveDown(0.3);
      }

      doc.moveDown(0.5);
      if (i < questions.length - 1) {
        doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#cccccc').stroke();
        doc.moveDown(0.5);
      }
    });
  }

  private renderQuiz(doc: any, questions: AnsweredQuestion[]): void {
    doc.fontSize(18).font('Helvetica-Bold').text('Quick Quiz', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica').text(
      'Test yourself — try answering before checking the answers section above.',
      { align: 'center' },
    );
    doc.moveDown(1.5);

    questions.forEach((q, i) => {
      doc.fontSize(12).font('Helvetica-Bold').text(`${i + 1}. ${q.text}`);
      doc.moveDown(0.8);
      doc.moveTo(50, doc.y).lineTo(400, doc.y).strokeColor('#aaaaaa').dash(4, { space: 4 }).stroke();
      doc.undash();
      doc.moveDown(0.8);
    });
  }
}
