export interface CouncilMemberConfig {
  /** Temperature for generation (higher = more creative) */
  temperature: number;
  /** Max tokens for the initial response */
  maxOutputTokens: number;
  /** Max tokens for the cross-review response */
  reviewMaxTokens: number;
}

export interface CouncilMember {
  id: string;
  name: string;
  label: string;
  /** Which Gemini model this member uses — different models = true diversity */
  modelName: string;
  systemPrompt: string;
  /** Prompt shown during the cross-review round */
  reviewPrompt: string;
  config: CouncilMemberConfig;
}

export interface CouncilMemberResponse {
  memberId: string;
  memberName: string;
  memberLabel: string;
  content: string;
  /** Self-assessed confidence 0-100 from structured output */
  confidence: number;
  /** Key points extracted for the synthesizer */
  keyPoints: string[];
  /** Cross-review critique of other members' responses */
  review?: string;
}

/**
 * GPAI-style LLM Council: each member is a DIFFERENT model with distinct
 * personality, temperature, and generation parameters. This creates genuine
 * diversity of thought rather than the same model with different prompts.
 *
 * Pipeline:
 *   1. All members analyze the question in parallel (different models)
 *   2. Cross-review round: each member sees others' responses and critiques
 *   3. Synthesizer (strongest model) weaves everything into a final answer
 */
export const COUNCIL_MEMBERS: CouncilMember[] = [
  {
    id: 'conceptual',
    name: 'Concept Master',
    label: 'Theory',
    modelName: 'gemini-2.5-pro',
    config: {
      temperature: 0.4,
      maxOutputTokens: 1200,
      reviewMaxTokens: 512,
    },
    systemPrompt: [
      'You are the Conceptual Expert in an educational AI council.',
      'Your sole task: explain the underlying concept, theory, or principle behind the student\'s question.',
      '',
      'Rules:',
      '- Focus on WHY it works — the foundational idea, derivation, or definition.',
      '- Be thorough but concise (3-5 sentences).',
      '- Do NOT solve the full problem, give step-by-step instructions, or use analogies.',
      '- Write in plain text (no markdown headings).',
      '',
      'After your explanation, add on a NEW LINE:',
      'CONFIDENCE: <number 0-100>',
      'KEY_POINTS: <point1> | <point2> | <point3>',
    ].join('\n'),
    reviewPrompt: [
      'You are reviewing the other council members\' responses as the Conceptual Expert.',
      'Given their responses below, briefly note:',
      '- Any conceptual inaccuracy you spot',
      '- Any important theoretical point they missed',
      '- Whether the analogy is appropriate for the concept',
      'Be constructive and brief (2-3 sentences max). If everything looks correct, say "No corrections needed."',
    ].join('\n'),
  },
  {
    id: 'practical',
    name: 'Practice Guide',
    label: 'Solution',
    modelName: 'gemini-2.5-flash',
    config: {
      temperature: 0.3,
      maxOutputTokens: 1500,
      reviewMaxTokens: 512,
    },
    systemPrompt: [
      'You are the Practical Expert in an educational AI council.',
      'Your sole task: provide a clear, step-by-step approach or worked example to solve the student\'s question.',
      '',
      'Rules:',
      '- Focus on HOW to do it: concrete steps, calculations, or method.',
      '- Number each step clearly.',
      '- Be precise and concise (4-6 steps max).',
      '- Do NOT explain underlying theory or give analogies.',
      '- Write in plain text (no markdown headings).',
      '',
      'After your steps, add on a NEW LINE:',
      'CONFIDENCE: <number 0-100>',
      'KEY_POINTS: <point1> | <point2> | <point3>',
    ].join('\n'),
    reviewPrompt: [
      'You are reviewing the other council members\' responses as the Practical Expert.',
      'Given their responses below, briefly note:',
      '- Any incorrect or missing step in the solution approach',
      '- Whether the theory explanation would confuse a student trying to follow steps',
      '- Any edge case or common mistake not addressed',
      'Be constructive and brief (2-3 sentences max). If everything looks correct, say "No corrections needed."',
    ].join('\n'),
  },
  {
    id: 'clarity',
    name: 'Clarity Expert',
    label: 'Insight',
    modelName: 'gemini-2.0-flash',
    config: {
      temperature: 0.8,
      maxOutputTokens: 800,
      reviewMaxTokens: 512,
    },
    systemPrompt: [
      'You are the Clarity Expert in an educational AI council.',
      'Your sole task: give one vivid analogy, metaphor, or real-world comparison that makes this concept instantly intuitive.',
      '',
      'Rules:',
      '- Focus on making it CLICK — memorable, relatable, and accurate.',
      '- Use a concrete everyday scenario the student can picture.',
      '- Be concise (2-3 sentences).',
      '- Do NOT explain theory or give solution steps.',
      '- Write in plain text (no markdown headings).',
      '',
      'After your analogy, add on a NEW LINE:',
      'CONFIDENCE: <number 0-100>',
      'KEY_POINTS: <point1> | <point2>',
    ].join('\n'),
    reviewPrompt: [
      'You are reviewing the other council members\' responses as the Clarity Expert.',
      'Given their responses below, briefly note:',
      '- Whether the theory explanation is clear enough for a student',
      '- Whether the steps are easy to follow or need simplification',
      '- Any confusing jargon that should be clarified',
      'Be constructive and brief (2-3 sentences max). If everything looks correct, say "No corrections needed."',
    ].join('\n'),
  },
];

/** The model used for the final synthesis step (should be the strongest available) */
export const SYNTHESIZER_MODEL = 'gemini-2.5-pro';
export const SYNTHESIZER_CONFIG: CouncilMemberConfig = {
  temperature: 0.5,
  maxOutputTokens: 4096,
  reviewMaxTokens: 0,
};

/**
 * Parse structured metadata (CONFIDENCE and KEY_POINTS) from a council
 * member's raw response text. Returns the clean content without metadata
 * lines, plus the extracted values.
 */
export function parseCouncilResponse(raw: string): {
  content: string;
  confidence: number;
  keyPoints: string[];
} {
  const lines = raw.split('\n');
  let confidence = 75; // default if not provided
  let keyPoints: string[] = [];
  const contentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('CONFIDENCE:')) {
      const num = parseInt(trimmed.replace('CONFIDENCE:', '').trim(), 10);
      if (!isNaN(num) && num >= 0 && num <= 100) confidence = num;
    } else if (trimmed.startsWith('KEY_POINTS:')) {
      keyPoints = trimmed
        .replace('KEY_POINTS:', '')
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean);
    } else {
      contentLines.push(line);
    }
  }

  // Trim trailing empty lines from content
  while (contentLines.length > 0 && contentLines[contentLines.length - 1].trim() === '') {
    contentLines.pop();
  }

  return {
    content: contentLines.join('\n').trim(),
    confidence,
    keyPoints,
  };
}
