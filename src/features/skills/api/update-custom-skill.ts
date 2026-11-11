import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq, ne } from 'drizzle-orm';
import { db } from '@/db';
import { skill } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { skillDirectoryForUpload, validateSkillFiles } from '../lib/skill-files';
import type { SkillFileEntry, SkillListItem } from '../types';
import { entryContent, toListItem } from './skill-list-item';
import { claimPublication, finishPublication } from './skill-transitions';

export async function updateCustomSkill(input: {
  workspaceId: string;
  skillId: string;
  name: string;
  description?: string | null;
  files: SkillFileEntry[];
}): Promise<SkillListItem> {
  validateSkillFiles(input.files);
  const existing = (
    await db
      .select()
      .from(skill)
      .where(
        and(
          eq(skill.id, input.skillId),
          eq(skill.ownerWorkspaceId, input.workspaceId),
          eq(skill.kind, 'custom'),
        ),
      )
  ).at(0);
  if (!existing)
    throw new AppError('WORKSPACE_NOT_FOUND', 'skill not found in workspace', {
      skillId: input.skillId,
    });
  const ready = await finishPublication(existing);
  const collision = (
    await db
      .select({ id: skill.id })
      .from(skill)
      .where(
        and(
          eq(skill.ownerWorkspaceId, input.workspaceId),
          eq(skill.name, input.name),
          ne(skill.id, input.skillId),
        ),
      )
  ).at(0);
  if (collision)
    throw new AppError('CONFLICT', 'a skill with this name already exists', { name: input.name });
  const claimed = await claimPublication(ready, {
    token: randomUUID(),
    name: input.name,
    description: input.description || null,
    directory: skillDirectoryForUpload(input.files, input.name),
    files: input.files,
    sourceHash: null,
  });
  const updated = await finishPublication(claimed);
  return toListItem(updated, {
    fileCount: input.files.length,
    entryContent: entryContent(input.files),
  });
}
