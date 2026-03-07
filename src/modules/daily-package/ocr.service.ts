import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private readonly genAI: GoogleGenerativeAI;

  constructor(private readonly config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(config.get<string>('NEW_GEMINI_KEY', ''));
  }

  /**
   * Extracts question text from handwritten image buffers using Gemini Vision.
   * Returns a flat array of raw question strings (may contain duplicates).
   */
  async extractQuestions(imageBuffers: Buffer[]): Promise<string[]> {
    const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const allQuestions: string[] = [];

    for (const buffer of imageBuffers) {
      try {
        const result = await model.generateContent([
          {
            inlineData: {
              data: buffer.toString('base64'),
              mimeType: 'image/jpeg',
            },
          },
          `These are photos of student handwritten questions from a class session.
           Extract every question you can read clearly, one per line.
           Ignore illegible or partial text.
           Return ONLY the questions — no numbering, no explanation, no other text.`,
        ]);

        const text = result.response.text().trim();
        const questions = text
          .split('\n')
          .map((q) => q.trim())
          .filter((q) => q.length > 5);

        allQuestions.push(...questions);
        this.logger.log(`Extracted ${questions.length} questions from image`);
      } catch (err) {
        this.logger.error(`OCR failed for image: ${err.message}`);
      }
    }

    return allQuestions;
  }
}
