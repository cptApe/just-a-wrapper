import { PRESET_SKILLS } from '@/features/skills/constants';
import type { AdminPrompt } from '@/lib/admin-prompt';
import { brand } from '@/lib/brand/identity';

export function brandRenamePrompt(): AdminPrompt {
  return {
    where: `NEXT_PUBLIC_BRAND_NAME in .env and the hosting provider (the name people see), content/brand.ts (slug and repository), the preset content folders ${PRESET_SKILLS.map((skill) => skill.contentDir).join(', ')}, src/features/skills/constants.ts (preset registry), and src/app/globals.css (colours)`,
    what: [
      `Rename this fork from "${brand.name}" to the new name.`,
      `Record git status --short first so work in progress is not overwritten. Then set NEXT_PUBLIC_BRAND_NAME (currently ${brand.name}) wherever the app is deployed and redeploy, because the name is fixed at build time. If the code itself is renamed, change slug and repositoryUrl in content/brand.ts (currently ${brand.slug}, ${brand.repositoryUrl}).`,
      'Keep the App Guide name, content/app-guide folder, and app-guide upload directory unchanged when rebranding. Update its description and bundled product copy to the new brand.',
      `Search the repo for the old name and slug, and replace the product copy, examples, and bundled content that should follow the brand.`,
      'If the accent or destructive colour changes, edit the light and dark variables in src/app/globals.css.',
    ].join(' '),
    guardrails: [
      'Every preset upload directory must equal the slug of its skill name ("App Guide" gives "app-guide"). pnpm validate:config and tests/skills/preset-content-dirs.test.mjs both fail otherwise.',
      'A renamed preset is a new upstream skill identity at Anthropic, not a new version of the old one: the rename re-provisions the skill for every workspace, and the old name cannot be published under again.',
      'The name, web address and support email are configuration, never code: do not write them into content/brand.ts or anywhere in src.',
      'Investigate every remaining match of the old brand instead of replacing blindly: historical records, external identifiers, and migrations keep the old string on purpose.',
    ],
    verify: [
      'pnpm validate:config',
      'node --import ./scripts/register-aliases.mjs --test tests/skills/preset-content-dirs.test.mjs',
      `rg -n "${brand.name}|${brand.slug}" src content scripts, and say why each remaining match stays`,
      'pnpm verify',
      'Load the customize-brand skill (.claude/skills/customize-brand/SKILL.md) before starting, and follow it for anything this prompt leaves open',
    ],
  };
}
