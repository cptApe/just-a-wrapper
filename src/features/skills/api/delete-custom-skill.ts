import 'server-only';

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { skill } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { removeSkill } from './skill-transitions';

// Delete upstream first: deleting only the local row could strand a title that cannot be reused.
// Remote deletion is idempotent, so retry heals a local failure after remote success.
export async function deleteCustomSkill(input: {
  workspaceId: string;
  skillId: string;
}): Promise<void> {
  const existing = (
    await db
      .select()
      .from(skill)
      .where(and(eq(skill.id, input.skillId), eq(skill.ownerWorkspaceId, input.workspaceId)))
      .limit(1)
  ).at(0);

  if (!existing) {
    throw new AppError('WORKSPACE_NOT_FOUND', 'skill not found in workspace', {
      workspaceId: input.workspaceId,
      skillId: input.skillId,
    });
  }
  if (existing.kind !== 'custom') {
    throw new AppError('TOOL_INPUT_INVALID', 'preset skills cannot be deleted', {
      workspaceId: input.workspaceId,
      skillId: input.skillId,
    });
  }

  await removeSkill(existing);
}

// Keep the agent tool name-addressed; ownership checks stay inside the feature.
export async function deleteCustomSkillByName(input: {
  workspaceId: string;
  name: string;
}): Promise<void> {
  const existing = (
    await db
      .select({ id: skill.id })
      .from(skill)
      .where(and(eq(skill.ownerWorkspaceId, input.workspaceId), eq(skill.name, input.name)))
      .limit(1)
  ).at(0);
  if (!existing) {
    throw new AppError('WORKSPACE_NOT_FOUND', 'skill not found in workspace', {
      workspaceId: input.workspaceId,
      name: input.name,
    });
  }
  await deleteCustomSkill({
    workspaceId: input.workspaceId,
    skillId: existing.id,
  });
}
