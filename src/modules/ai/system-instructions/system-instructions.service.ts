import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CouncilMember, CouncilMemberResponse } from '../council-members';

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
   * Provider-agnostic system prompt text for single-AI mode.
   */
  getSystemPromptText(ctx: SystemPromptContext): string {
    const override =
      this.configService.get<string>('AI_SYSTEM_PROMPT') ||
      this.configService.get<string>('GEMINI_SYSTEM_PROMPT');

    if (override && override.trim()) {
      return override.trim();
    }

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

  /**
   * Returns the system prompt for a specific council member persona.
   * The member already carries its own prompt — this method allows
   * optional subject injection for context.
   */
  getCouncilMemberPrompt(member: CouncilMember, subject?: string | null): string {
    const subjectLine = subject ? `\nThe topic relates to: ${subject}.` : '';
    return member.systemPrompt + subjectLine;
  }

  /**
   * Builds the cross-review prompt for a council member to critique
   * the other members' responses. This is the GPAI-style "debate" round.
   */
  getCrossReviewPrompt(
    reviewer: CouncilMember,
    otherResponses: CouncilMemberResponse[],
    userQuestion: string,
  ): string {
    const othersText = otherResponses
      .filter((r) => r.memberId !== reviewer.id)
      .map(
        (r) =>
          `[${r.memberLabel}] ${r.memberName} (confidence: ${r.confidence}/100):\n${r.content}`,
      )
      .join('\n\n');

    return [
      reviewer.reviewPrompt,
      '',
      `Student question: "${userQuestion}"`,
      '',
      'Other experts\' responses:',
      othersText,
    ].join('\n');
  }

  /**
   * Builds the enhanced synthesizer system prompt that combines council member
   * responses, their confidence scores, key points, and cross-review critiques
   * into a single coherent tutor answer.
   */
  getSynthesizerPrompt(
    memberResponses: CouncilMemberResponse[],
    userQuestion: string,
  ): string {
    const perspectivesText = memberResponses
      .map((m) => {
        const parts = [
          `[${m.memberLabel}] ${m.memberName} (confidence: ${m.confidence}/100):`,
          m.content,
        ];
        if (m.keyPoints.length > 0) {
          parts.push(`Key points: ${m.keyPoints.join('; ')}`);
        }
        if (m.review && m.review !== 'No corrections needed.') {
          parts.push(`Cross-review note: ${m.review}`);
        }
        return parts.join('\n');
      })
      .join('\n\n---\n\n');

    // Calculate average confidence for guidance
    const avgConfidence =
      memberResponses.reduce((sum, m) => sum + m.confidence, 0) /
      memberResponses.length;

    const confidenceGuidance =
      avgConfidence >= 85
        ? 'The experts are highly confident — deliver a clear, authoritative answer.'
        : avgConfidence >= 60
          ? 'The experts have moderate confidence — present the answer clearly but note any areas of uncertainty.'
          : 'The experts have lower confidence — be transparent about limitations and suggest the student verify key points.';

    return [
      'You are an expert educational tutor synthesizing insights from a council of three specialists.',
      'Each specialist used a different AI model and has a distinct expertise area.',
      '',
      confidenceGuidance,
      '',
      'Rules:',
      '- Write as a personal tutor speaking directly to the student (use "you", not "the student").',
      '- Use Markdown with `###` headings and bullet points where helpful.',
      '- Integrate the conceptual explanation, step-by-step approach, and analogy naturally.',
      '- If any cross-review note flags an error, incorporate the correction in your synthesis.',
      '- Weight higher-confidence responses more heavily.',
      '- Do NOT mention "experts", "council", "perspectives", "models", or "specialists" — write as one voice.',
      '- End with one check-for-understanding question.',
      '',
      `Student question: "${userQuestion}"`,
      '',
      'Expert perspectives to synthesize:',
      perspectivesText,
    ].join('\n');
  }
}
