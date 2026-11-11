import 'server-only';

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '@/lib/errors';
import { PRESET_SKILLS } from '../constants';
import { skillCustomerBenefit } from '../lib/admin-copy';
import { buildSkillsAdminMarkdown, type ShippedSkill } from '../lib/admin-markdown';
import { skillsAdminPromptText } from '../lib/admin-prompt';
import { parseSkillFrontmatter } from '../lib/skill-files';

async function readShippedSkill(preset: (typeof PRESET_SKILLS)[number]): Promise<ShippedSkill> {
  const source = path.join(process.cwd(), preset.contentDir, 'SKILL.md');

  try {
    const content = await readFile(source, 'utf8');
    const frontmatter = parseSkillFrontmatter(content);
    if (frontmatter.name === null || frontmatter.description === null) {
      throw new AppError(
        'VALIDATION_FAILED',
        'An included skill is missing its name or description.',
        { source },
      );
    }
    return {
      id: preset.directory,
      name: frontmatter.name,
      description: frontmatter.description,
      customerBenefit: skillCustomerBenefit(preset.directory),
    };
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    throw new AppError(
      'VALIDATION_FAILED',
      'An included skill could not be read.',
      { source },
      { cause },
    );
  }
}

export function loadShippedSkills(): Promise<ShippedSkill[]> {
  return Promise.all(PRESET_SKILLS.map(readShippedSkill));
}

export async function skillsAdminMarkdown(): Promise<string> {
  return buildSkillsAdminMarkdown({
    skills: await loadShippedSkills(),
    promptText: skillsAdminPromptText(),
  });
}
