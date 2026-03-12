import { Injectable, Logger } from '@nestjs/common';
import { Subject } from '@prisma/client';
import { LlmService } from '../llm/llm.service';

export interface AnsweredQuestion {
  text: string;
  frequency: number;
  rankType: 'MOST_ASKED' | 'BEST_ASKED' | null;
  rankPosition: number | null;
  shortAnswer: string;
  fullAnswer: string;
  realLifeExample: string;
  similarQuestions: string[];
}

interface LLMQuestionResult {
  canonicalQuestion: string;
  frequency: number;
  rankType: 'MOST_ASKED' | 'BEST_ASKED' | null;
  rankPosition: number | null;
  shortAnswer: string;
  fullAnswer: string;
  realLifeExample: string;
  similarQuestions: string[];
}

@Injectable()
export class AnswerGenerationService {
  private readonly logger = new Logger(AnswerGenerationService.name);

  constructor(private readonly llm: LlmService) {}

  /**
   * Single SOTA model call that handles grouping, ranking, AND answering.
   * The LLM understands semantic similarity, so "What is photosynthesis?" and
   * "Can you explain photosynthesis?" get grouped correctly.
   */
  async rankAndAnswer(rawQuestions: string[], subject: Subject): Promise<AnsweredQuestion[]> {
    if (rawQuestions.length === 0) return [];

    const questionsBlock = rawQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n');

    try {
      const result = await this.llm.generateFromPrompt('question-ranking-answering', {
        subject,
        questionsBlock,
      });

      const raw = result.text.trim();
      const jsonStr = raw.replace(/^```json\s*/g, '').replace(/^```\s*/g, '').replace(/```$/g, '').trim();
      const parsed: LLMQuestionResult[] = JSON.parse(jsonStr);

      this.logger.log(
        `LLM grouped ${rawQuestions.length} raw questions into ${parsed.length} unique questions ` +
        `(${parsed.filter((q) => q.rankType === 'MOST_ASKED').length} most-asked, ` +
        `${parsed.filter((q) => q.rankType === 'BEST_ASKED').length} best-asked)`,
      );

      return parsed.map((q) => ({
        text: q.canonicalQuestion,
        frequency: q.frequency ?? 1,
        rankType: q.rankType ?? null,
        rankPosition: q.rankPosition ?? null,
        shortAnswer: q.shortAnswer ?? '',
        fullAnswer: q.fullAnswer ?? '',
        realLifeExample: q.realLifeExample ?? '',
        similarQuestions: q.similarQuestions ?? [],
      }));
    } catch (err: any) {
      this.logger.error(`Rank-and-answer failed: ${err.message}`);

      // Fallback: return raw questions ungrouped, no answers
      return rawQuestions.slice(0, 20).map((q) => ({
        text: q.trim(),
        frequency: 1,
        rankType: null,
        rankPosition: null,
        shortAnswer: '',
        fullAnswer: '',
        realLifeExample: '',
        similarQuestions: [],
      }));
    }
  }
}
