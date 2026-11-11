import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { skill } from '@/db/schema';
import { AppError } from '@/lib/errors';
import type { SkillFileEntry, SkillListItem } from '../types';
import { createCustomSkill } from './create-custom-skill';
import { updateCustomSkill } from './update-custom-skill';

// Agent-facing updates use user-readable names, keeping database IDs out of the conversation.
export async function updateCustomSkillByName(input: {
  workspaceId: string;
  currentName: string;
  name: string;
  description?: string | null;
  files: SkillFileEntry[];
}): Promise<SkillListItem> {
  const existing = (
    await db
      .select({ id: skill.id })
      .from(skill)
      .where(and(eq(skill.ownerWorkspaceId, input.workspaceId), eq(skill.name, input.currentName)))
      .limit(1)
  ).at(0);
  if (!existing) {
    throw new AppError('WORKSPACE_NOT_FOUND', 'skill not found in workspace', {
      workspaceId: input.workspaceId,
      name: input.currentName,
    });
  }
  return updateCustomSkill({
    workspaceId: input.workspaceId,
    skillId: existing.id,
    name: input.name,
    description: input.description,
    files: input.files,
  });
}

// A matching workspace name updates in place. Global presets cannot match this owner-scoped lookup.
export async function saveCustomSkill(input: {
  workspaceId: string;
  userId: string;
  name: string;
  description?: string | null;
  files: SkillFileEntry[];
}): Promise<SkillListItem> {
  const existing = (
    await db
      .select({ id: skill.id })
      .from(skill)
      .where(and(eq(skill.ownerWorkspaceId, input.workspaceId), eq(skill.name, input.name)))
      .limit(1)
  ).at(0);
  if (existing) {
    return updateCustomSkill({ ...input, skillId: existing.id });
  }
  return createCustomSkill(input);
}
