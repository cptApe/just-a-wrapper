import type { Capabilities } from '@/lib/capabilities';
import { personalitySections } from './prompt-admin-content';

// The text behind the Prompts page's personality button. The dashboard never edits prompts itself, so each payload points a coding agent at
// the source and repeats the rules that keep an edit from breaking downstream.
//
// The shapes here match `AdminPrompt` (src/lib/admin-prompt.ts)
// structurally; they are left unannotated so this module stays free of
// server-only imports and can be unit-tested directly.
//
// The seed reminder is on every one of them on purpose. Prompt text is the only
// configuration in this app that lives in TWO places: the repo, and the agents
// already created on Anthropic's platform. Editing the constant changes nothing
// a user experiences until `pnpm seed:agents` pushes it.
const SEED_REMINDER =
  'REQUIRED: run pnpm seed:agents afterwards. The live agents on Anthropic keep running the OLD text until this pushes the change; confirm the reported agent versions bump';

const SHARED_GUARDRAILS = [
  'Every plan runs this one prompt, so a change applies to all of them',
  'No em dashes anywhere in the persona copy, and no exclamation-point enthusiasm',
  'The composed prompts are seeded to the live agents, so the text is production configuration, not a doc',
];

const SHARED_VERIFY = ['pnpm validate:config', 'pnpm verify', 'pnpm test:unit', SEED_REMINDER];

/** The personality prompt names the ordered constants without copying their text. */
export function personalityAdminPrompt(capabilities: Capabilities) {
  const sectionIds = personalitySections(capabilities)
    .map(({ section }) => section.id)
    .join(', ');
  return {
    where: 'src/features/agent-setup/system-prompts.ts',
    what: `Change the agent personality I describe. Read the file before editing it. Keep these sections in this composition order: ${sectionIds}.`,
    guardrails: SHARED_GUARDRAILS,
    verify: SHARED_VERIFY,
  };
}
