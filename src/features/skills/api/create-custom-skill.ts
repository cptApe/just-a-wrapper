import 'server-only';

import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { skill } from '@/db/schema';
import { captureEvent } from '@/lib/analytics';
import { AppError } from '@/lib/errors';
import { skillDirectoryForUpload, validateSkillFiles } from '../lib/skill-files';
import type { SkillFileEntry, SkillListItem } from '../types';
import { entryContent, toListItem } from './skill-list-item';
import { claimPublication, finishPublication, reserveSkill } from './skill-transitions';

type CreateSkillInput = {
  workspaceId: string;
  userId: string;
  name: string;
  description?: string | null;
  files: SkillFileEntry[];
};

export async function createCustomSkill(input: CreateSkillInput): Promise<SkillListItem> {
  validateSkillFiles(input.files);
  const publication = {
    token: randomUUID(),
    name: input.name,
    description: input.description || null,
    directory: skillDirectoryForUpload(input.files, input.name),
    files: input.files,
    sourceHash: null,
  };
  const reserved = await reserveSkill(
    {
      kind: 'custom',
      ownerWorkspaceId: input.workspaceId,
      name: input.name,
      createdByUserId: input.userId,
    },
    publication,
  );
  const existing =
    reserved ??
    (
      await db
        .select()
        .from(skill)
        .where(and(eq(skill.ownerWorkspaceId, input.workspaceId), eq(skill.name, input.name)))
    ).at(0);
  if (
    !existing ||
    (existing.status !== 'publishing' && existing.anthropicSkillId !== null) ||
    existing.status === 'deleting'
  ) {
    throw new AppError('CONFLICT', 'a skill with this name already exists', {
      workspaceId: input.workspaceId,
      name: input.name,
    });
  }
  const pending = existing.publication;
  if (
    pending &&
    (pending.name !== input.name ||
      pending.description !== (input.description || null) ||
      pending.files.length !== input.files.length ||
      input.files.some(
        (file) =>
          !pending.files.some(
            (saved) => saved.path === file.path && saved.content === file.content,
          ),
      ))
  ) {
    throw new AppError('CONFLICT', 'A different publication already owns this skill name', {
      workspaceId: input.workspaceId,
      name: input.name,
    });
  }
  const recoverable =
    existing.status === 'ready' ? await claimPublication(existing, publication) : existing;
  const created = await finishPublication(recoverable);
  captureEvent(
    'skill:install',
    { skill_id: created.id, skill_kind: 'custom', file_count: input.files.length },
    { userId: input.userId, workspaceId: input.workspaceId },
  );
  const files = existing.publication?.files ?? input.files;
  return toListItem(created, { fileCount: files.length, entryContent: entryContent(files) });
}
