import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Extracts question text from handwritten image buffers using AI Vision.
   * Batches images (5 per call) and processes batches concurrently.
   * Returns a flat array of raw question strings (may contain duplicates).
   */
  async extractQuestions(imageBuffers: Buffer[]): Promise<string[]> {
    const BATCH_SIZE = 5;
    const batches = this.chunkArray(imageBuffers, BATCH_SIZE);
    this.logger.log(
      `Processing ${imageBuffers.length} images in ${batches.length} batch(es) of up to ${BATCH_SIZE}`,
    );

    const results = await Promise.allSettled(
      batches.map((batch) => this.extractFromBatch(batch)),
    );

    const allQuestions: string[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allQuestions.push(...result.value);
      } else {
        this.logger.error(`OCR batch failed: ${result.reason?.message}`);
      }
    }

    return allQuestions;
  }

  private async extractFromBatch(buffers: Buffer[]): Promise<string[]> {
    const inlineDataParts = buffers.map((buffer) => ({
      inlineData: {
        data: buffer.toString('base64'),
        mimeType: 'image/jpeg' as const,
      },
    }));

    const result = await this.llm.generateFromPrompt('ocr-question-extraction', undefined, {
      userParts: inlineDataParts,
    });

    const questions = result.text
      .trim()
      .split('\n')
      .map((q) => q.trim())
      .filter((q) => q.length > 5);

    this.logger.log(`Extracted ${questions.length} questions from batch of ${buffers.length} images`);
    return questions;
  }

  private chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
