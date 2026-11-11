import { brand } from '@/lib/brand/identity';
import type { Capabilities } from '@/lib/capabilities';
import { OTHER_PROMPTS, personalityDocument, registryEntryText } from './prompt-admin-content';

function fence(text: string): string {
  return ['```text', text, '```'].join('\n');
}

function appMessages(): string {
  return OTHER_PROMPTS.map(({ title, entry }) =>
    [`### ${title}`, fence(registryEntryText(entry))].join('\n\n'),
  ).join('\n\n');
}

/** The human-first twin of /admin/prompts, built from the same real text. */
export function promptsMarkdown(capabilities: Capabilities): string {
  return [
    '# Prompts',
    `The words ${brand.name} gives your agent, ready to read and change.`,
    "## Your agent's personality",
    fence(personalityDocument(capabilities)),
    '## After you change these prompts',
    'The live agents on Anthropic keep running the OLD text until you push the change. After any edit to src/features/agent-setup/system-prompts.ts, run `pnpm seed:agents` and confirm the reported agent versions bump.',
    '## Messages added by the app',
    appMessages(),
  ].join('\n\n');
}
