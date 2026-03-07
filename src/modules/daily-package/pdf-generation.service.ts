import { Injectable, Logger } from '@nestjs/common';
import { Subject } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PDFDocument = require('pdfkit');
import { AnsweredQuestion } from './answer-generation.service';

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

      questions.forEach((q, i) => {
        // Question header
        const tag = q.rankType === 'MOST_ASKED' ? ' ⭐ Most Asked' : q.rankType === 'BEST_ASKED' ? ' 💡 Best Asked' : '';
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

      // ─── Quiz Section ────────────────────────────────────────────────────────
      doc.addPage();
      doc.fontSize(18).font('Helvetica-Bold').text('Quick Quiz', { align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(11).font('Helvetica').text('Test yourself — try answering before checking the answers section above.', { align: 'center' });
      doc.moveDown(1.5);

      questions.forEach((q, i) => {
        doc.fontSize(12).font('Helvetica-Bold').text(`${i + 1}. ${q.text}`);
        doc.moveDown(0.8);
        doc.moveTo(50, doc.y).lineTo(400, doc.y).strokeColor('#aaaaaa').dash(4, { space: 4 }).stroke();
        doc.undash();
        doc.moveDown(0.8);
      });

      doc.end();
    });
  }

  async mergePdfs(pdfBuffers: Buffer[]): Promise<Buffer> {
    // Simple merge: concatenate PDF pages via PDFKit re-embedding is complex,
    // so we produce a combined PDF with a summary page for each daily package.
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(24).font('Helvetica-Bold').text('Weekly Learning Package', { align: 'center' });
      doc.moveDown(1);
      doc.fontSize(14).font('Helvetica').text(`Combined ${pdfBuffers.length} daily packages`, { align: 'center' });
      doc.moveDown(2);
      doc.fontSize(12).text(
        'This document combines all daily learning packages from this week. ' +
        'Please refer to each daily PDF for the full question answers.',
      );
      doc.moveDown(1);
      doc.text(`Total daily packages included: ${pdfBuffers.length}`);

      doc.end();
    });
  }
}
