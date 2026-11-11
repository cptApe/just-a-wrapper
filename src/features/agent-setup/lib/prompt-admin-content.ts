import type { Capabilities } from '@/lib/capabilities';
import { AppError } from '@/lib/errors';
import { PROMPT_REGISTRY, type PromptRegistryEntry } from '../prompt-registry';
import { composeSystemPrompt, type PromptSection, promptSections } from '../system-prompts';

// The human names on /admin/prompts. Every title points to one real source
// entry. Keeping this mapping beside the page's prompt helpers means the page
// and its Markdown twin cannot quietly call the same text two different things.

const PERSONALITY_SECTION_TITLES: Record<string, string> = {
  ROLE: 'Who it is',
  VOICE: 'How it works and talks',
  WORKPLACE: 'How it uses your app',
  FILES: 'How it handles files',
  webSection: 'How it uses the web',
};

const OTHER_PROMPT_TITLES: Record<string, string> = {
  'session-grounding-block': 'What it knows when a task starts',
  'current-time-line': 'How it knows the current time',
  'session-start-user-text': 'How it wraps the first message',
  'session-title-system': 'How it names a task',
  'session-title-message': 'What the task namer reads',
  'deployment-events-event': 'How Balanced and Expert scheduled tasks start',
  'deployment-events-inline': 'How Fast scheduled tasks start',
};

export type TitledPromptSection = {
  title: string;
  section: PromptSection;
};
export type TitledRegistryEntry = { title: string; entry: PromptRegistryEntry };

function titleSection(section: PromptSection): TitledPromptSection {
  const title = PERSONALITY_SECTION_TITLES[section.id];
  if (!title) {
    throw new AppError('UNEXPECTED', 'The Prompts page is missing a plain section title', {
      sectionId: section.id,
    });
  }
  return { title, section };
}

export const personalitySections = (capabilities: Capabilities): readonly TitledPromptSection[] =>
  promptSections(capabilities).map(titleSection);

export const personalityDocument = (capabilities: Capabilities): string =>
  composeSystemPrompt(capabilities);

export const OTHER_PROMPTS: readonly TitledRegistryEntry[] = PROMPT_REGISTRY.filter(
  (entry) => entry.group !== 'system-prompt',
).map((entry) => {
  const title = OTHER_PROMPT_TITLES[entry.id];
  if (!title) {
    throw new AppError('UNEXPECTED', 'The Prompts page is missing a plain title', {
      promptId: entry.id,
    });
  }
  return { title, entry };
});

export function registryEntryText(entry: PromptRegistryEntry): string {
  return entry.text || 'No text to show';
}
