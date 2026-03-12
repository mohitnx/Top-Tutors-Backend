import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Extracts question text from handwritten image buffers using AI Vision.
   * Returns a flat array of raw question strings (may contain duplicates).
   */
  async extractQuestions(imageBuffers: Buffer[]): Promise<string[]> {
    const allQuestions: string[] = [];

    for (const buffer of imageBuffers) {
      try {
        const result = await this.llm.generateFromPrompt('ocr-question-extraction', undefined, {
          userParts: [
            {
              inlineData: {
                data: buffer.toString('base64'),
                mimeType: 'image/jpeg',
              },
            },
          ],
        });

        const questions = result.text
          .trim()
          .split('\n')
          .map((q) => q.trim())
          .filter((q) => q.length > 5);

        allQuestions.push(...questions);
        this.logger.log(`Extracted ${questions.length} questions from image`);
      } catch (err: any) {
        this.logger.error(`OCR failed for image: ${err.message}`);
      }
    }

    return allQuestions;
  }
}
