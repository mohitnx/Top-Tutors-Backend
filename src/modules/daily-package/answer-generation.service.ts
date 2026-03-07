import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { Subject } from '@prisma/client';

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
  private readonly genAI: GoogleGenerativeAI;

  constructor(private readonly config: ConfigService) {
    this.genAI = new GoogleGenerativeAI(config.get<string>('NEW_GEMINI_KEY', ''));
  }

  /**
   * Single SOTA model call that handles grouping, ranking, AND answering.
   * Replaces the old 2-step approach (naive word-overlap ranking + separate answer generation).
   *
   * The LLM understands semantic similarity, so "What is photosynthesis?" and
   * "Can you explain photosynthesis?" get grouped correctly — something word-overlap can't do.
   */
  async rankAndAnswer(rawQuestions: string[], subject: Subject): Promise<AnsweredQuestion[]> {
    if (rawQuestions.length === 0) return [];

    const model = this.genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 8192,
      },
    });

    const questionsBlock = rawQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n');

    const prompt = `You are an expert ${subject} teacher analyzing questions collected from students in a classroom.

TASK: You will receive a list of raw student questions (extracted via OCR from handwritten papers). Many questions will be duplicates or near-duplicates asked in different words. You must:

1. GROUP semantically similar questions together (e.g. "What is photosynthesis?" and "Can you explain photosynthesis?" are the same question)
2. For each unique question, count how many students asked it (frequency)
3. RANK questions into two categories:
   - MOST_ASKED: Top 5 questions by frequency (most students asked these)
   - BEST_ASKED: Top 5 questions by depth/quality that are NOT already in MOST_ASKED (questions using "why", "how", "explain", "compare", or showing deeper thinking)
4. For every ranked question (MOST_ASKED + BEST_ASKED), generate structured answers

Return a JSON array where each element represents one UNIQUE question group:
{
  "canonicalQuestion": "The cleanest/best-worded version of the question",
  "frequency": <number of students who asked this or a similar question>,
  "rankType": "MOST_ASKED" | "BEST_ASKED" | null,
  "rankPosition": <1-5 within its category, or null if unranked>,
  "shortAnswer": "2-3 sentence direct answer for quick revision (empty string if unranked)",
  "fullAnswer": "Detailed explanation in 4-6 sentences (empty string if unranked)",
  "realLifeExample": "One concrete real-world application or analogy (empty string if not applicable or unranked)",
  "similarQuestions": ["list of other wordings students used for this same question"]
}

RULES:
- Group aggressively: different wordings of the same question = one group
- Only generate answers for ranked questions (MOST_ASKED or BEST_ASKED) to save effort
- Unranked questions still appear in the output with empty answers
- Sort output: MOST_ASKED first (by position), then BEST_ASKED (by position), then unranked (by frequency desc)
- Return ONLY the JSON array, no markdown fences, no explanation

RAW STUDENT QUESTIONS:
${questionsBlock}`;

    try {
      const result = await model.generateContent(prompt);
      const raw = result.response.text().trim();
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
    } catch (err) {
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
