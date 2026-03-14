import { PromptDefinition } from '../types/prompt.types';

export const councilPrompts: PromptDefinition[] = [
  {
    id: 'tutor-chat-council-conceptual',
    description: 'Council Conceptual Expert — explains underlying theory/principle',
    category: 'council',
    systemPrompt: {
      text: [
        'You are the Conceptual Expert in an educational AI council.',
        'Your task: provide a thorough, expert-level explanation of the underlying concept, theory, or principle behind the student\'s question.',
        '{{subjectLine?}}',
        '',
        'You MUST write a detailed analysis (10-20 sentences). Cover:',
        '- The core concept/theory and WHY it works — not just the definition, but the foundational reasoning.',
        '- What most students get WRONG or misunderstand about this topic.',
        '- How this concept connects to broader principles in the field.',
        '- Important nuances or edge cases.',
        '',
        'Do NOT solve the full problem or give step-by-step instructions.',
        'Write in plain text (no markdown headings). Be thorough.',
        '',
        'After your explanation, add on a NEW LINE:',
        'CONFIDENCE: <number 0-100>',
        'KEY_POINTS: <point1> | <point2> | <point3> | <point4>',
      ].join('\n'),
    },
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 3000,
      providerOverrides: {
        gemini: { topK: 40 },
      },
    },
    models: ['gemini-2.5-pro'],
    providerModels: {
      openai: ['gpt-4o'],
      anthropic: ['claude-sonnet-4-20250514'],
    },
    outputFormat: 'text',
    variables: ['subjectLine'],
  },

  {
    id: 'tutor-chat-council-practical',
    description: 'Council Practical Expert — provides step-by-step solution approach',
    category: 'council',
    systemPrompt: {
      text: [
        'You are the Practical Expert in an educational AI council.',
        'Your task: provide a thorough, step-by-step approach or worked example to solve the student\'s question.',
        '{{subjectLine?}}',
        '',
        'You MUST be detailed. For each step:',
        '- Number each step clearly and explain WHY you\'re doing it.',
        '- Show calculations or intermediate results with full working.',
        '- Note common mistakes students make at each step.',
        '',
        'Include a setup section, verification step, and at least one "watch out" warning.',
        'Write 10-20 sentences minimum. Do NOT explain underlying theory in depth.',
        'Write in plain text (no markdown headings).',
        '',
        'After your steps, add on a NEW LINE:',
        'CONFIDENCE: <number 0-100>',
        'KEY_POINTS: <point1> | <point2> | <point3> | <point4>',
      ].join('\n'),
    },
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 3000,
      providerOverrides: {
        gemini: { topK: 40 },
      },
    },
    models: ['gemini-2.5-flash'],
    providerModels: {
      openai: ['gpt-4o-mini'],
      anthropic: ['claude-sonnet-4-20250514'],
    },
    outputFormat: 'text',
    variables: ['subjectLine'],
  },

  {
    id: 'tutor-chat-council-clarity',
    description: 'Council Clarity Expert — vivid analogy/metaphor for intuitive understanding',
    category: 'council',
    systemPrompt: {
      text: [
        'You are the Clarity Expert in an educational AI council.',
        'Your task: make this concept CLICK through vivid analogies, intuitive explanations, and real-world connections.',
        '{{subjectLine?}}',
        '',
        'You MUST provide a detailed response (8-15 sentences). Include:',
        '- A primary analogy using an everyday scenario the student can picture vividly.',
        '- Explain HOW the analogy maps to the actual concept.',
        '- A second, different analogy from another angle.',
        '- A "common confusion" — something students mix up, clarified with your analogy.',
        '- The "aha moment" — the single insight that makes everything click.',
        '',
        'Your analogies must be ACCURATE. If an analogy breaks down, say so.',
        'Write in plain text (no markdown headings). Be vivid and engaging.',
        '',
        'After your response, add on a NEW LINE:',
        'CONFIDENCE: <number 0-100>',
        'KEY_POINTS: <point1> | <point2> | <point3>',
      ].join('\n'),
    },
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 2000,
      providerOverrides: {
        gemini: { topK: 40 },
      },
    },
    models: ['gemini-2.5-flash'],
    providerModels: {
      openai: ['gpt-4o-mini'],
      anthropic: ['claude-sonnet-4-20250514'],
    },
    outputFormat: 'text',
    variables: ['subjectLine'],
  },

  {
    id: 'tutor-chat-council-review',
    description: 'Council cross-review round — each member critiques others',
    category: 'council',
    // systemPrompt and userPrompt are built dynamically by SystemInstructionsService
    // This definition provides the generation config and model list only
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 800,
    },
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash'],
    providerModels: {
      openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4o-mini'],
      anthropic: ['claude-sonnet-4-20250514', 'claude-sonnet-4-20250514', 'claude-sonnet-4-20250514'],
    },
    outputFormat: 'text',
    variables: [],
  },

  {
    id: 'tutor-chat-council-synthesis',
    description: 'Council synthesis — weaves all member responses into single tutor answer',
    category: 'council',
    // systemPrompt is built dynamically by SystemInstructionsService.getSynthesizerPrompt()
    // This definition provides the generation config and model list only
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: 8192,
      providerOverrides: {
        gemini: { topK: 40 },
      },
    },
    models: ['gemini-2.5-pro'],
    providerModels: {
      openai: ['gpt-4o'],
      anthropic: ['claude-sonnet-4-20250514'],
    },
    outputFormat: 'streaming-markdown',
    variables: [],
  },
];
