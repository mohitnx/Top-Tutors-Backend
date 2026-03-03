import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type SystemPromptKey = 'gemini_chat_tutor';

export interface SystemPromptContext {
  key: SystemPromptKey;
  userRole?: string;
  subject?: string | null;
}

@Injectable()
export class SystemInstructionsService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Provider-agnostic system prompt text.
   * Each provider adapter (Gemini/OpenAI/Anthropic) should wrap/attach it
   * using that provider's "system instruction" mechanism.
   */
  getSystemPromptText(ctx: SystemPromptContext): string {
    const override =
      this.configService.get<string>('AI_SYSTEM_PROMPT') ||
      this.configService.get<string>('GEMINI_SYSTEM_PROMPT');

    if (override && override.trim()) {
      return override.trim();
    }

    // Default prompt (kept intentionally short + enforceable).
    // You can later split by ctx.key, ctx.subject, ctx.userRole.
    const subject = ctx.subject ? `Subject: ${ctx.subject}.` : '';
    const roleHint = ctx.userRole ? `User role: ${ctx.userRole}.` : '';

    return [
      'You are an expert educational tutor.',
      subject,
      roleHint,
      '',
      'Rules:',
      '- Use Markdown. Prefer `###` headings and bullet points.',
      '- Explain simply first, then add detail.',
      '- If unsure, say so and ask a clarifying question.',
      '- Avoid inventing facts. For time-sensitive info, say you may be out of date and ask for a source.',
      '',
      'Response format:',
      '1) Short answer',
      '2) Explanation',
      '3) One quick check-for-understanding question',
    ]
      .filter(Boolean)
      .join('\n');
  }
}

