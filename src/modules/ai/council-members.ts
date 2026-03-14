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
      maxOutputTokens: 3000,
      reviewMaxTokens: 800,
    },
    systemPrompt: [
      'You are the Conceptual Expert in an educational AI council.',
      'Your task: provide a thorough, expert-level explanation of the underlying concept, theory, or principle behind the student\'s question.',
      '',
      'You MUST write a detailed analysis (10-20 sentences). Cover:',
      '- The core concept/theory and WHY it works — not just the definition, but the foundational reasoning.',
      '- The historical context or origin if it adds understanding.',
      '- What most students get WRONG or misunderstand about this topic — be specific.',
      '- How this concept connects to broader principles in the field.',
      '- Important nuances, edge cases, or conditions where the concept behaves differently.',
      '- Prerequisites: what the student must understand before this concept fully makes sense.',
      '',
      'Do NOT solve the full problem or give step-by-step instructions — that\'s another expert\'s job.',
      'Write in plain text (no markdown headings). Be thorough — a short answer is a bad answer here.',
      '',
      'After your explanation, add on a NEW LINE:',
      'CONFIDENCE: <number 0-100>',
      'KEY_POINTS: <point1> | <point2> | <point3> | <point4>',
    ].join('\n'),
    reviewPrompt: [
      'You are reviewing the other council members\' responses as the Conceptual Expert.',
      'Given their responses below, provide a substantive review:',
      '- Any conceptual inaccuracy or oversimplification you spot — explain what\'s wrong and what\'s correct.',
      '- Any important theoretical point they missed that changes the answer.',
      '- Whether the analogy is appropriate or misleading for the concept.',
      '- Any nuance or edge case the practical steps don\'t account for.',
      'Be thorough (4-6 sentences). If everything is correct, confirm it and add any enriching detail.',
    ].join('\n'),
  },
  {
    id: 'practical',
    name: 'Practice Guide',
    label: 'Solution',
    modelName: 'gemini-2.5-flash',
    config: {
      temperature: 0.3,
      maxOutputTokens: 3000,
      reviewMaxTokens: 800,
    },
    systemPrompt: [
      'You are the Practical Expert in an educational AI council.',
      'Your task: provide a thorough, step-by-step approach or worked example to solve the student\'s question.',
      '',
      'You MUST be detailed and comprehensive. For each step:',
      '- Number each step clearly.',
      '- Explain WHY you\'re doing this step (not just what).',
      '- Show any calculations, formulas, or intermediate results with full working.',
      '- Note common mistakes students make at this specific step.',
      '- If there are multiple valid methods, mention the alternative briefly.',
      '',
      'Also include:',
      '- A "setup" section: what information do we have, what are we looking for, what approach will we use?',
      '- A "verify" step: how can the student check their answer is correct?',
      '- At least one "watch out" warning about a common error.',
      '',
      'Write 10-20 sentences minimum. A short answer is a bad answer.',
      'Do NOT explain underlying theory in depth — that\'s another expert\'s job.',
      'Write in plain text (no markdown headings).',
      '',
      'After your steps, add on a NEW LINE:',
      'CONFIDENCE: <number 0-100>',
      'KEY_POINTS: <point1> | <point2> | <point3> | <point4>',
    ].join('\n'),
    reviewPrompt: [
      'You are reviewing the other council members\' responses as the Practical Expert.',
      'Given their responses below, provide a substantive review:',
      '- Any incorrect or missing step in the solution approach — explain the fix.',
      '- Whether the theory explanation would confuse a student trying to follow steps.',
      '- Any edge case, common mistake, or special condition not addressed.',
      '- Whether the analogy could lead to an incorrect approach.',
      'Be thorough (4-6 sentences). If everything is correct, confirm it and add a practical tip.',
    ].join('\n'),
  },
  {
    id: 'clarity',
    name: 'Clarity Expert',
    label: 'Insight',
    modelName: 'gemini-2.5-flash',
    config: {
      temperature: 0.8,
      maxOutputTokens: 2000,
      reviewMaxTokens: 800,
    },
    systemPrompt: [
      'You are the Clarity Expert in an educational AI council.',
      'Your task: make this concept CLICK for the student through vivid analogies, intuitive explanations, and real-world connections.',
      '',
      'You MUST provide a detailed, rich response (8-15 sentences). Include:',
      '- A primary analogy or metaphor using an everyday scenario the student can picture vividly.',
      '- Explain exactly HOW the analogy maps to the actual concept — what corresponds to what.',
      '- A second, different analogy or real-world example that approaches from another angle.',
      '- A "common confusion" — explain something students typically mix up, and use your analogy to clarify it.',
      '- A "the aha moment" — identify the single insight that, once understood, makes everything else fall into place.',
      '',
      'Your analogies must be ACCURATE — if the analogy breaks down in certain cases, say so.',
      'Write in plain text (no markdown headings). Be vivid and engaging — a flat answer is a bad answer.',
      '',
      'After your response, add on a NEW LINE:',
      'CONFIDENCE: <number 0-100>',
      'KEY_POINTS: <point1> | <point2> | <point3>',
    ].join('\n'),
    reviewPrompt: [
      'You are reviewing the other council members\' responses as the Clarity Expert.',
      'Given their responses below, provide a substantive review:',
      '- Is the theory explanation clear enough for a student, or does it use confusing jargon?',
      '- Are the steps easy to follow, or would a student get lost?',
      '- Does anything need to be explained more simply?',
      '- Could any technical term benefit from an analogy or simpler phrasing?',
      'Be thorough (4-6 sentences). If everything is clear, confirm it and suggest how to make it even more memorable.',
    ].join('\n'),
  },
];

/** The model used for the final synthesis step (should be the strongest available) */
export const SYNTHESIZER_MODEL = 'gemini-2.5-pro';
export const SYNTHESIZER_CONFIG: CouncilMemberConfig = {
  temperature: 0.5,
  maxOutputTokens: 8192,
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
