import { PromptDefinition } from '../types/prompt.types';

export const classificationPrompts: PromptDefinition[] = [
  {
    id: 'subject-detection',
    description: 'Classify message content into one academic subject',
    category: 'classification',
    userPrompt: {
      text: 'Classify this content into one of these subjects: {{validSubjects}}. Return only the subject name, nothing else: "{{content}}"',
    },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 20,
    },
    models: ['gemini-2.5-flash', 'gemini-flash-latest'],
    providerModels: {
      openai: ['gpt-4o-mini'],
      anthropic: ['claude-sonnet-4-20250514'],
    },
    outputFormat: 'text',
    variables: ['content', 'validSubjects'],
  },

  {
    id: 'message-classification',
    description: 'Classify student question into subject, topic, keywords, urgency for tutor routing',
    category: 'classification',
    userPrompt: {
      text: `You are an educational assistant. Analyze this student question and classify it.

Student's question: "{{text}}"

Respond with ONLY a valid JSON object (no markdown, no code blocks) in this exact format:
{
  "detectedLanguage": "en",
  "subject": "MATHEMATICS",
  "topic": "Brief topic description",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "urgency": "NORMAL"
}

IMPORTANT RULES:
- subject MUST be EXACTLY one of these values: MATHEMATICS, PHYSICS, CHEMISTRY, BIOLOGY, ENGLISH, HISTORY, GEOGRAPHY, COMPUTER_SCIENCE, ECONOMICS, SOCIAL, HUMANITIES, ARTS, ACCOUNTING, GENERAL
- For questions about computers, programming, coding, software, LLM, AI, machine learning, algorithms, data structures → use COMPUTER_SCIENCE
- For questions about math, calculus, algebra, geometry, statistics → use MATHEMATICS
- For questions about physics, mechanics, electricity, waves → use PHYSICS
- For questions about chemistry, molecules, reactions, elements → use CHEMISTRY
- For questions about biology, cells, organisms, genetics → use BIOLOGY
- For questions about English, writing, grammar, literature → use ENGLISH
- For questions about history, wars, civilizations, historical events → use HISTORY
- For questions about geography, maps, countries, climate → use GEOGRAPHY
- For questions about economics, markets, trade, macroeconomics → use ECONOMICS
- For questions about social studies, sociology, psychology, economics → use SOCIAL
- For questions about humanities, literature, philosophy, history → use HUMANITIES
- For questions about arts, music, painting, sculpture → use ARTS
- For questions about accounting, finance, bookkeeping → use ACCOUNTING
- Only use GENERAL if the question doesn't fit any other category
- urgency MUST be one of: LOW, NORMAL, HIGH, URGENT (HIGH if student mentions exam/test/deadline, URGENT if very immediate)
- keywords should be 3-5 relevant terms
- topic should be a brief 2-5 word description`,
    },
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256,
    },
    models: ['gemini-2.5-flash', 'gemini-flash-latest'],
    providerModels: {
      openai: ['gpt-4o-mini'],
      anthropic: ['claude-sonnet-4-20250514'],
    },
    outputFormat: 'json',
    variables: ['text'],
  },
];
