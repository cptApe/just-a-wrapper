import { type AdminPrompt, formatAdminPrompt } from '@/lib/admin-prompt';
import { PRESET_SKILLS } from '../constants';

// Include the current registry and deployment rules so an agent can add a preset without
// missing slug validation, whole-folder hashing, or the explicit backfill for stamped workspaces.
function skillsAddPrompt(): AdminPrompt {
  return {
    where:
      '`src/features/skills/constants.ts` (the `PRESET_SKILLS` array), plus a new `content/<folder>/` folder for the skill itself. The folder name is yours to pick and does not have to match the upload slug; one of the shipped presets already differs',
    what: `Add a preset skill named X: one \`PresetSkill\` entry in the registry and a matching \`SKILL.md\` content folder. The pack currently holds ${PRESET_SKILLS.length} presets: ${PRESET_SKILLS.map((preset) => preset.name).join(', ')}. Put the new entry where it should sit in the pack.`,
    guardrails: [
      'Load the `customize-skills-pack` skill before editing the pack: it is the executable playbook for this registry',
      '`directory` must equal `slugifyConfigName(name)`: lowercase the display name, drop every character that is not an ASCII letter, digit, whitespace, or hyphen, trim it, then turn the spaces into hyphens',
      "The content folder is read recursively and every file in it is hashed, so it must hold only that skill's files",
      'The root `SKILL.md` needs YAML frontmatter whose `name` is exactly the registry display name',
      'Preset rows are global and owned by this fork, so do not add a per-workspace copy of the skill',
      "A new entry does not reach a running deployment on its own: the `ready` provisioning status on the owner's `workspace_member` row short-circuits the completeness check, so an already-provisioned workspace only receives it through one deliberate `pnpm skills:backfill` pass against that deployment",
      'Renaming an existing preset creates a new upstream identity (the preset name identifies its global row) and leaves the old global preset row behind as a retired preset: hidden and unattached, but not deleted until someone removes it',
      'Removing an entry retires the preset the same way: its row and remote skill stay, and it stops being provisioned, listed, or attached to new sessions',
    ],
    verify: [
      '`pnpm validate:config`',
      '`pnpm verify`',
      '`pnpm skills:backfill` once the entry is deployed, with `.env` pointing at that deployment (needs `DATABASE_URL` and `ANTHROPIC_API_KEY`)',
    ],
  };
}

export function skillsAdminPromptText(): string {
  return formatAdminPrompt(skillsAddPrompt());
}
