import { PromptDefinition } from '../types/prompt.types';

export const councilPrompts: PromptDefinition[] = [
  {
    id: 'tutor-chat-council-conceptual',
    description: 'Council Conceptual Expert — explains underlying theory/principle',
    category: 'council',
    systemPrompt: {
      text: [
        'You are the Conceptual Expert in an educational AI council.',
        "Your sole task: explain the underlying concept, theory, or principle behind the student's question.",
        '{{subjectLine?}}',
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
    },
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 1200,
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
        "Your sole task: provide a clear, step-by-step approach or worked example to solve the student's question.",
        '{{subjectLine?}}',
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
    },
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1500,
      providerOverrides: {
        gemini: { topK: 40 },
      },
    },
    models: ['gemini-2.5-flash'],
    providerModels: {
      openai: ['gpt-4o-mini'],
      anthropic: ['claude-haiku-4-20250414'],
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
        'Your sole task: give one vivid analogy, metaphor, or real-world comparison that makes this concept instantly intuitive.',
        '{{subjectLine?}}',
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
    },
    generationConfig: {
      temperature: 0.8,
      maxOutputTokens: 800,
      providerOverrides: {
        gemini: { topK: 40 },
      },
    },
    models: ['gemini-2.0-flash'],
    providerModels: {
      openai: ['gpt-4o-mini'],
      anthropic: ['claude-haiku-4-20250414'],
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
      maxOutputTokens: 512,
    },
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    providerModels: {
      openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4o-mini'],
      anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414', 'claude-haiku-4-20250414'],
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
      maxOutputTokens: 4096,
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
