import type { KitRelease } from '@content/changelog';
import { type AdminPrompt, formatAdminPrompt } from '@/lib/admin-prompt';

/** The files a fork customizes, where a merge conflict lands. */
const FORK_OWNED_SURFACES = [
  'content/brand.ts',
  'src/app/globals.css',
  'src/features/billing/pricing-config.ts',
  'src/lib/composio/toolkits.ts',
  'src/features/skills/constants.ts',
  'src/features/agents/config.ts',
  'src/features/agent-setup/system-prompts.ts',
  'src/lib/env-schema.ts',
  'src/lib/env.ts',
] as const;

/** How the prompt refers to the release notes. `inline` lists them inside the
    prompt, for the copy button, which travels alone. `reference` points at the
    notes already printed above it, for the markdown twin, where listing them
    twice would just make the page longer. */
export type MergePromptNotes = 'inline' | 'reference';

function whatToDo(release: KitRelease, notes: MergePromptNotes): string {
  const opening = `Pull upstream release ${release.version} "${release.title}". The areas touched are ${release.areas.join(', ')}.`;
  return notes === 'reference'
    ? `${opening} Work from the release notes listed above this prompt and merge the upstream changes into your fork.`
    : [
        `${opening} Review the release notes below and merge the upstream changes into your fork.`,
        ...release.notes.map((note) => `- ${note}`),
      ].join('\n');
}

function mergePrompt(release: KitRelease, notes: MergePromptNotes): AdminPrompt {
  return {
    where: `your repo root, starting with content/changelog.ts release ${release.version}`,
    what: whatToDo(release, notes),
    guardrails: [
      `Your customizations live in the named config surfaces (${FORK_OWNED_SURFACES.join(', ')}) and take precedence on conflict`,
      'Never let an upstream merge overwrite your brand, pricing, or prompt copy without review',
    ],
    verify: ['pnpm validate:config', 'pnpm verify'],
  };
}

/** Agent-ready markdown for one release, in the four-part admin prompt shape. */
export function formatMergePrompt(release: KitRelease, notes: MergePromptNotes = 'inline'): string {
  return formatAdminPrompt(mergePrompt(release, notes));
}

export function formatMergePromptsInApplyOrder(
  releases: readonly KitRelease[],
  notes: MergePromptNotes = 'inline',
): string {
  // The changelog is newest first, but forks must apply missed releases oldest first.
  return [...releases]
    .reverse()
    .map((release) => formatMergePrompt(release, notes))
    .join('\n\n');
}
