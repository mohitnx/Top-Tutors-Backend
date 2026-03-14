import { PromptDefinition } from '../types/prompt.types';

export const generationPrompts: PromptDefinition[] = [
  {
    id: 'title-generation',
    description: 'Generate a short title (max 6 words) from a chat message',
    category: 'generation',
    userPrompt: {
      text: 'Generate a very short title (max 6 words) for this question. Return only the title, nothing else: "{{content}}"',
    },
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 50,
    },
    models: ['gemini-2.5-flash', 'gemini-flash-latest'],
    providerModels: {
      openai: ['gpt-4o-mini'],
      anthropic: ['claude-sonnet-4-20250514'],
    },
    outputFormat: 'text',
    variables: ['content'],
  },

  {
    id: 'conversation-analysis',
    description: 'Analyze full AI chat conversation for tutor matching — extracts summary, topic, subject, keywords',
    category: 'generation',
    userPrompt: {
      text: `Analyze this student-AI conversation and provide:
1. A comprehensive summary (2-3 paragraphs) explaining what the student is struggling with
2. The main topic they need help with (concise, 5-10 words)
3. The academic subject (one of: MATHEMATICS, PHYSICS, CHEMISTRY, BIOLOGY, ENGLISH, HISTORY, GEOGRAPHY, COMPUTER_SCIENCE, ECONOMICS, SOCIAL, HUMANITIES, ARTS, ACCOUNTING, GENERAL)
4. Key keywords/concepts mentioned (up to 5)

Conversation:
{{conversationText}}

Respond in JSON format:
{
  "summary": "detailed summary here",
  "topic": "main topic",
  "subject": "SUBJECT_NAME",
  "keywords": ["keyword1", "keyword2"]
}`,
    },
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
    },
    models: ['gemini-2.5-flash', 'gemini-flash-latest'],
    providerModels: {
      openai: ['gpt-4o-mini'],
      anthropic: ['claude-sonnet-4-20250514'],
    },
    outputFormat: 'json',
    variables: ['conversationText'],
  },

  {
    id: 'question-ranking-answering',
    description: 'Group, rank, and answer batch OCR questions for daily learning packages',
    category: 'generation',
    userPrompt: {
      text: `You are an expert {{subject}} teacher analyzing questions collected from students in a classroom.

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
{{questionsBlock}}`,
    },
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 8192,
    },
    models: ['gemini-2.5-flash'],
    providerModels: {
      openai: ['gpt-4o'],
      anthropic: ['claude-sonnet-4-20250514'],
    },
    outputFormat: 'json',
    variables: ['subject', 'questionsBlock'],
  },

  {
    id: 'quiz-generation',
    description: 'Generate quizzes from student project study materials',
    category: 'generation',
    userPrompt: {
      text: `Based on the following study materials, generate a quiz with {{questionCount}} questions.

Quiz type: {{quizType}}
Difficulty: {{difficulty}}

Format rules:
- For MCQ: provide 4 options (A-D), mark the correct answer, and explain why.
- For TRUE_FALSE: state the claim, provide the answer, and explain.
- For SHORT_ANSWER: ask the question, provide the expected answer, and key points.
- For MIXED: use a variety of the above types.
- Number each question clearly.
- Put answers in a separate "## Answers" section at the end.
- Make questions that test understanding, not just memorization.

## Study Materials:
{{resourceContext}}`,
    },
    generationConfig: {
      temperature: 0.5,
      topP: 0.95,
      maxOutputTokens: 8192,
      providerOverrides: {
        gemini: { topK: 40 },
      },
    },
    models: ['gemini-2.5-flash', 'gemini-flash-latest'],
    providerModels: {
      openai: ['gpt-4o', 'gpt-4o-mini'],
      anthropic: ['claude-sonnet-4-20250514'],
    },
    outputFormat: 'streaming-markdown',
    variables: ['questionCount', 'quizType', 'difficulty', 'resourceContext'],
  },
];
