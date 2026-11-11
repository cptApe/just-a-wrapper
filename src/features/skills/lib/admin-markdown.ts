import { ANTHROPIC_SKILLS_DOCS_URL } from './admin-copy';

export type ShippedSkill = {
  id: string;
  name: string;
  description: string;
  customerBenefit: string;
};

function escapeMarkdownText(value: string): string {
  return value.replaceAll(/([\\`*_[\]<>])/g, '\\$1');
}

function shippedSkillsList(skills: readonly ShippedSkill[]): string {
  if (skills.length === 0) return 'No skills are included yet';
  // The customer-facing cards intentionally show only customerBenefit. This
  // agent-facing twin keeps each frontmatter description because it explains
  // when and how the agent should use the skill.
  return skills
    .map((skill) =>
      [
        `- **${escapeMarkdownText(skill.name)}:** ${escapeMarkdownText(skill.description)}`,
        `  - For your customers: ${escapeMarkdownText(skill.customerBenefit)}`,
      ].join('\n'),
    )
    .join('\n');
}

export function buildSkillsAdminMarkdown(input: {
  skills: readonly ShippedSkill[];
  promptText: string;
}): string {
  return [
    '# Skills',
    `A skill gives your agent reusable instructions for a specific kind of work. Every skill in this bundled pack reaches each customer workspace automatically; [Anthropic’s guide to skills](${ANTHROPIC_SKILLS_DOCS_URL}) explains how skills work.`,
    '## What’s included',
    shippedSkillsList(input.skills),
    'Add a skill with your agent:',
    ['```', input.promptText, '```'].join('\n'),
  ].join('\n\n');
}
