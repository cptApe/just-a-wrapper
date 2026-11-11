import 'server-only';

import { and, asc, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { skill, skillFile } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { isRetiredPresetRow } from '../lib/preset-retirement';
import { SKILL_ENTRY_FILE } from '../lib/skill-files';
import type { SkillDetail, SkillKind, SkillListItem, SkillSessionRef } from '../types';
import { toListItem } from './skill-list-item';

export async function listSkillsForWorkspace(input: {
  workspaceId: string;
}): Promise<SkillListItem[]> {
  const rows = (
    await db
      .select()
      .from(skill)
      .where(visibleToWorkspace(input.workspaceId))
      .orderBy(sql`${skill.ownerWorkspaceId} is null desc`, desc(skill.updatedAt))
  ).filter((row) => !isRetiredPresetRow(row));

  if (rows.length === 0) return [];

  // One pass over the folders' metadata: counts for every skill, plus the
  // entry file's content for the connections chips.
  const ids = rows.map((row) => row.id);
  const fileRows = await db
    .select({ skillId: skillFile.skillId, path: skillFile.path, content: skillFile.content })
    .from(skillFile)
    .where(inArray(skillFile.skillId, ids));

  const fileCounts = new Map<string, number>();
  const entryContents = new Map<string, string>();
  for (const file of fileRows) {
    fileCounts.set(file.skillId, (fileCounts.get(file.skillId) ?? 0) + 1);
    if (file.path === SKILL_ENTRY_FILE) entryContents.set(file.skillId, file.content);
  }

  return rows.map((row) =>
    toListItem(row, {
      fileCount: fileCounts.get(row.id) ?? 0,
      entryContent: entryContents.get(row.id) ?? null,
    }),
  );
}

// Agent-facing saved skills exclude presets: those are available to sessions but not authored
// by this workspace. Match the name and description users recognize.
export async function listCustomSkillsForWorkspace(input: {
  workspaceId: string;
  query?: string;
}): Promise<SkillListItem[]> {
  const skills = (await listSkillsForWorkspace({ workspaceId: input.workspaceId })).filter(
    (item) => item.kind === 'custom',
  );
  const query = input.query?.trim().toLocaleLowerCase();
  if (!query) return skills;
  return skills.filter(
    (item) =>
      item.name.toLocaleLowerCase().includes(query) ||
      item.description?.toLocaleLowerCase().includes(query),
  );
}

// Global presets are shared; custom skills require workspace ownership. Retired presets read as missing.
export async function getSkillDetail(input: {
  workspaceId: string;
  skillId: string;
}): Promise<SkillDetail> {
  const row = (
    await db
      .select()
      .from(skill)
      .where(and(eq(skill.id, input.skillId), visibleToWorkspace(input.workspaceId)))
      .limit(1)
  ).at(0);
  if (!row || isRetiredPresetRow(row)) {
    throw new AppError('WORKSPACE_NOT_FOUND', 'skill not found in workspace', {
      workspaceId: input.workspaceId,
      skillId: input.skillId,
    });
  }

  const files =
    row.status === 'publishing' && row.publication !== null
      ? row.publication.files
      : await db
          .select({ path: skillFile.path, content: skillFile.content })
          .from(skillFile)
          .where(eq(skillFile.skillId, row.id))
          .orderBy(asc(skillFile.path));

  // SKILL.md leads the tree; everything else stays alphabetical.
  const ordered = [
    ...files.filter((file) => file.path === SKILL_ENTRY_FILE),
    ...files.filter((file) => file.path !== SKILL_ENTRY_FILE),
  ];
  const entry = ordered.find((file) => file.path === SKILL_ENTRY_FILE) ?? null;

  return {
    ...toListItem(row, { fileCount: ordered.length, entryContent: entry?.content ?? null }),
    files: ordered,
  };
}

/** A skill a session can load: published upstream, not being deleted, and not a retired preset. */
export type AttachableSkill = {
  id: string;
  name: string;
  description: string | null;
  kind: SkillKind;
  anthropicSkillId: string;
  latestVersion: string;
  updatedAt: Date;
};

/**
 * The one predicate for "a session gets this skill". Session creation attaches exactly this set,
 * and the composer's skills picker offers it, so the picker never names a skill the agent lacks.
 * Several rows can name one upstream skill; the newest wins because Anthropic rejects duplicates.
 */
export async function listAttachableSkills(input: {
  workspaceId: string;
}): Promise<AttachableSkill[]> {
  const rows = await db
    .select({
      id: skill.id,
      kind: skill.kind,
      name: skill.name,
      description: skill.description,
      anthropicSkillId: skill.anthropicSkillId,
      latestVersion: skill.latestVersion,
      updatedAt: skill.updatedAt,
    })
    .from(skill)
    .where(
      and(
        or(
          eq(skill.ownerWorkspaceId, input.workspaceId),
          and(isNull(skill.ownerWorkspaceId), eq(skill.kind, 'preset')),
        ),
        inArray(skill.status, ['ready', 'publishing']),
        isNotNull(skill.anthropicSkillId),
        isNotNull(skill.latestVersion),
      ),
    )
    .orderBy(desc(skill.updatedAt));

  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const { anthropicSkillId, latestVersion } = row;
    if (!anthropicSkillId || !latestVersion || isRetiredPresetRow(row)) return [];
    if (seen.has(anthropicSkillId)) return [];
    seen.add(anthropicSkillId);
    return [{ ...row, anthropicSkillId, latestVersion }];
  });
}

export async function listSessionSkillRefs(input: {
  workspaceId: string;
}): Promise<SkillSessionRef[]> {
  // Presets and customs alike are org-created skills upstream, so both are 'custom' refs.
  return (await listAttachableSkills(input)).map((row) => ({
    id: row.anthropicSkillId,
    kind: 'custom' as const,
    version: row.latestVersion,
  }));
}

function visibleToWorkspace(workspaceId: string) {
  return or(eq(skill.ownerWorkspaceId, workspaceId), isNull(skill.ownerWorkspaceId));
}
