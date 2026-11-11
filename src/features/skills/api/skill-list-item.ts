import 'server-only';

import { skill } from '@/db/schema';
import { SKILL_ENTRY_FILE, skillConnectionsFromFiles } from '../lib/skill-files';
import type { SkillFileEntry, SkillListItem } from '../types';

type SkillRow = typeof skill.$inferSelect;
export function entryContent(files: SkillFileEntry[]): string | null {
  return files.find((file) => file.path === SKILL_ENTRY_FILE)?.content ?? null;
}

export function toListItem(
  row: SkillRow,
  meta: { fileCount: number; entryContent: string | null },
): SkillListItem {
  const content =
    row.status === 'publishing' && row.publication !== null
      ? entryContent(row.publication.files)
      : meta.entryContent;
  return {
    id: row.id,
    status: row.status,
    anthropicSkillId: row.anthropicSkillId,
    kind: row.kind,
    name: row.name,
    description: row.description,
    latestVersion: row.latestVersion,
    isPreset: row.kind !== 'custom',
    canEdit: row.kind === 'custom',
    connections: content ? skillConnectionsFromFiles([{ path: SKILL_ENTRY_FILE, content }]) : [],
    fileCount:
      row.status === 'publishing' && row.publication !== null
        ? row.publication.files.length
        : meta.fileCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
