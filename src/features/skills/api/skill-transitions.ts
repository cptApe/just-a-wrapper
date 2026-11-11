import 'server-only';

import { APIError } from '@anthropic-ai/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { skill, skillFile } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { isUniqueViolation } from '@/lib/is-unique-violation';
import { skillMachine } from '../lib/skill-machine';
import type { PushedSkill } from '../types';
import { anthropicSkills } from './anthropic-skills';

type SkillRow = typeof skill.$inferSelect;
type SavedPublication = NonNullable<SkillRow['publication']>;
export type Publication = Omit<SavedPublication, 'previousName' | 'versionOf'>;

export async function claimPublication(row: SkillRow, publication: Publication): Promise<SkillRow> {
  if (!skillMachine.can(row.status, 'publishing'))
    throw new AppError('CONFLICT', 'This skill is being deleted. Wait for deletion to finish.', {
      skillId: row.id,
    });
  try {
    const claimed = (
      await db
        .update(skill)
        .set({
          status: 'publishing',
          publication: {
            ...publication,
            previousName: row.name,
            versionOf: row.name === publication.name ? row.anthropicSkillId : null,
          },
          name: publication.name,
          revision: row.revision + 1,
        })
        .where(
          and(
            eq(skill.id, row.id),
            eq(skill.revision, row.revision),
            inArray(skill.status, skillMachine.sourcesOf('publishing')),
          ),
        )
        .returning()
    ).at(0);
    if (!claimed)
      throw new AppError('CONFLICT', 'Skill changed before publication', { skillId: row.id });
    return claimed;
  } catch (cause) {
    if (isUniqueViolation(cause))
      throw new AppError(
        'CONFLICT',
        'a skill with this name already exists',
        { skillId: row.id, name: publication.name },
        { cause },
      );
    throw cause;
  }
}

// The persisted token names the remote resource. A retry adopts only this exact publication.
async function pushPublication(publication: SavedPublication): Promise<PushedSkill> {
  if (publication.versionOf !== null) {
    const pushed = await anthropicSkills.createVersion({
      skillId: publication.versionOf,
      directory: publication.directory,
      files: publication.files,
    });
    return { skillId: publication.versionOf, version: pushed.version };
  }
  const displayTitle = `just-a-wrapper:${publication.token}`;
  try {
    return await anthropicSkills.createSkill({
      displayTitle,
      directory: publication.directory,
      files: publication.files,
    });
  } catch (cause) {
    // A duplicate title or ambiguous response can leave this publication upstream.
    const winner = await anthropicSkills.findSkillByTitle(displayTitle);
    if (!winner) throw cause;
    if (winner.version !== null) return { skillId: winner.skillId, version: winner.version };
    const version = await anthropicSkills.createVersion({
      skillId: winner.skillId,
      directory: publication.directory,
      files: publication.files,
    });
    return { skillId: winner.skillId, version: version.version };
  }
}

function isRejectedPublication(cause: unknown): boolean {
  for (let error = cause; error instanceof Error; error = error.cause) {
    if (error instanceof AppError && error.code === 'INTEGRATION_NOT_CONNECTED') return true;
    if (error instanceof APIError && error.status !== undefined)
      return error.status >= 400 && error.status < 500 && ![408, 409, 429].includes(error.status);
  }
  return false;
}

async function abandonPublication(row: SkillRow, publication: SavedPublication): Promise<boolean> {
  const guard = and(
    eq(skill.id, row.id),
    eq(skill.status, 'publishing'),
    eq(skill.revision, row.revision),
  );
  if (row.anthropicSkillId === null) {
    const removed = await db.delete(skill).where(guard).returning({ id: skill.id });
    return removed.length > 0;
  }
  const restore = (name: string) =>
    db
      .update(skill)
      .set({
        status: 'ready',
        publication: null,
        name,
        revision: row.revision + 1,
      })
      .where(guard)
      .returning({ id: skill.id });
  try {
    return (await restore(publication.previousName)).length > 0;
  } catch (cause) {
    if (!isUniqueViolation(cause)) throw cause;
    // Another skill can claim the previous name while this publication owns the new one.
    return (await restore(publication.name)).length > 0;
  }
}

export async function finishPublication(row: SkillRow): Promise<SkillRow> {
  if (row.status !== 'publishing' || row.publication === null) return row;
  const publication = row.publication;
  const current = (await db.select().from(skill).where(eq(skill.id, row.id))).at(0);
  if (!current || current.status !== 'publishing' || current.revision !== row.revision) {
    if (
      current?.status === 'ready' &&
      current.revision === row.revision + 1 &&
      current.name === publication.name &&
      (current.anthropicSkillId !== row.anthropicSkillId ||
        current.latestVersion !== row.latestVersion)
    )
      return current;
    throw new AppError('CONFLICT', 'Skill publication is no longer active', { skillId: row.id });
  }
  let pushed: PushedSkill;
  try {
    pushed = await pushPublication(publication);
  } catch (cause) {
    if (isRejectedPublication(cause) && !(await abandonPublication(row, publication)))
      throw new AppError(
        'CONFLICT',
        'Skill changed while publication was rejected',
        { skillId: row.id },
        { cause },
      );
    throw cause;
  }
  const finished = await commitPublication(row, publication, pushed);
  if (finished) return finished;
  // A delete can finish while the provider is still creating this identity.
  await anthropicSkills.deleteSkill(pushed.skillId);
  throw new AppError('CONFLICT', 'Skill was deleted during publication', { skillId: row.id });
}

async function commitPublication(
  row: SkillRow,
  publication: SavedPublication,
  pushed: PushedSkill,
): Promise<SkillRow | null> {
  return db.transaction(async (tx) => {
    const updated = (
      await tx
        .update(skill)
        .set({
          status: 'ready',
          revision: row.revision + 1,
          publication: null,
          name: publication.name,
          description: publication.description,
          sourceHash: publication.sourceHash,
          anthropicSkillId: pushed.skillId,
          latestVersion: pushed.version,
          // Existing sessions pin old identities; retain them until explicit skill deletion.
          retainedSkillIds:
            row.anthropicSkillId === null || publication.versionOf !== null
              ? row.retainedSkillIds
              : [...row.retainedSkillIds, row.anthropicSkillId],
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(skill.id, row.id),
            inArray(skill.status, skillMachine.sourcesOf('ready')),
            eq(skill.revision, row.revision),
          ),
        )
        .returning()
    ).at(0);
    if (!updated) {
      const current = (await tx.select().from(skill).where(eq(skill.id, row.id))).at(0);
      if (!current || current.status === 'deleting') return null;
      if (
        current.status === 'ready' &&
        current.revision === row.revision + 1 &&
        current.name === publication.name &&
        current.anthropicSkillId === pushed.skillId &&
        current.latestVersion === pushed.version
      )
        return current;
      throw new AppError('CONFLICT', 'Skill publication was superseded', { skillId: row.id });
    }
    await tx.delete(skillFile).where(eq(skillFile.skillId, row.id));
    await tx
      .insert(skillFile)
      .values(publication.files.map((file) => ({ skillId: row.id, ...file })));
    return updated;
  });
}

export async function reserveSkill(
  values: typeof skill.$inferInsert,
  publication: Publication,
): Promise<SkillRow | null> {
  const row = (
    await db
      .insert(skill)
      .values({
        ...values,
        status: 'publishing',
        publication: { ...publication, previousName: publication.name, versionOf: null },
      })
      .onConflictDoNothing()
      .returning()
  ).at(0);
  return row ?? null;
}

export async function removeSkill(row: SkillRow): Promise<void> {
  let deleting = row;
  if (row.status !== 'deleting') {
    const claimed = (
      await db
        .update(skill)
        .set({ status: 'deleting', revision: row.revision + 1 })
        .where(
          and(
            eq(skill.id, row.id),
            eq(skill.revision, row.revision),
            inArray(skill.status, skillMachine.sourcesOf('deleting')),
          ),
        )
        .returning()
    ).at(0);
    if (!claimed)
      throw new AppError('CONFLICT', 'Skill changed before deletion', { skillId: row.id });
    deleting = claimed;
  }
  const ids =
    deleting.anthropicSkillId === null
      ? deleting.retainedSkillIds
      : [...deleting.retainedSkillIds, deleting.anthropicSkillId];
  if (deleting.publication !== null && deleting.publication.versionOf === null) {
    const found = await anthropicSkills.findSkillByTitle(
      `just-a-wrapper:${deleting.publication.token}`,
    );
    if (found) ids.push(found.skillId);
  }
  for (const id of new Set(ids)) await anthropicSkills.deleteSkill(id);
  // A failed remote delete leaves the durable deleting row excluded from new sessions.
  const removed = await db
    .delete(skill)
    .where(
      and(
        eq(skill.id, row.id),
        eq(skill.revision, deleting.revision),
        eq(skill.status, 'deleting'),
      ),
    )
    .returning({ id: skill.id });
  if (removed.length === 0) {
    const current = (await db.select({ id: skill.id }).from(skill).where(eq(skill.id, row.id))).at(
      0,
    );
    if (current)
      throw new AppError('CONFLICT', 'Skill changed during deletion', { skillId: row.id });
  }
}
