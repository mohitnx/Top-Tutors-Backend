import { PromptDefinition, PromptId } from '../types/prompt.types';
import { chatPrompts } from './chat.prompts';
import { councilPrompts } from './council.prompts';
import { classificationPrompts } from './classification.prompts';
import { extractionPrompts } from './extraction.prompts';
import { generationPrompts } from './generation.prompts';

const allPrompts: PromptDefinition[] = [
  ...chatPrompts,
  ...councilPrompts,
  ...classificationPrompts,
  ...extractionPrompts,
  ...generationPrompts,
];

export const PROMPT_REGISTRY = new Map<PromptId, PromptDefinition>(
  allPrompts.map((p) => [p.id, p]),
);
