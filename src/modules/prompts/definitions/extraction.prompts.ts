import { PromptDefinition } from '../types/prompt.types';

export const extractionPrompts: PromptDefinition[] = [
  {
    id: 'ocr-question-extraction',
    description: 'Extract handwritten student questions from classroom images via vision',
    category: 'extraction',
    userPrompt: {
      text: [
        'These are photos of student handwritten questions from a class session.',
        'Extract every question you can read clearly, one per line.',
        'Ignore illegible or partial text.',
        'Return ONLY the questions — no numbering, no explanation, no other text.',
      ].join('\n'),
    },
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096,
    },
    models: ['gemini-2.5-flash', 'gemini-1.5-flash'],
    providerModels: {
      openai: ['gpt-4o', 'gpt-4o-mini'],
      anthropic: ['claude-opus-4-6', 'claude-sonnet-4-20250514'],
    },
    outputFormat: 'text',
    variables: [],
  },

  {
    id: 'resource-text-extraction',
    description: 'Extract all text from uploaded PDFs/images for project resource context',
    category: 'extraction',
    userPrompt: {
      text: 'Extract ALL text content from this document/image. Return only the extracted text, preserving structure and formatting. If it contains diagrams or figures, describe them briefly. Do not add any commentary.',
    },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192,
    },
    models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
    providerModels: {
      openai: ['gpt-4o', 'gpt-4o-mini'],
      anthropic: ['claude-opus-4-6', 'claude-sonnet-4-20250514'],
    },
    outputFormat: 'text',
    variables: [],
  },

  {
    id: 'audio-transcription',
    description: 'Transcribe student audio messages to text',
    category: 'extraction',
    userPrompt: {
      text: 'Transcribe this audio message accurately. The speaker is likely a student asking for help with their studies. Return only the transcription text, nothing else. If you cannot understand the audio, return "UNABLE_TO_TRANSCRIBE".',
    },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
    models: ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro'],
    providerModels: {
      openai: ['gpt-4o', 'gpt-4o-mini'],
    },
    outputFormat: 'text',
    variables: [],
  },
];
