import 'server-only';
import { and, eq, inArray, isNull, not, type SQL, sql } from 'drizzle-orm';
import { type DbTransaction, db } from '@/db';
import { file, folder } from '@/db/schema';
import { AppError } from '@/lib/errors';
import {
  AGENT_OUTPUT_FOLDER_PATHS,
  CHAT_UPLOADS_FOLDER_PATH,
  parentPath,
  ROOT,
  TEAM_FOLDER_PATH,
} from './paths';

// Moving a file under /Team shares it; moving it out restores creator-only visibility.
// Derive access from creator and path, with no per-file ACL column.
// This module owns SQL visibility predicates and shared-folder creation;
// paths.ts owns the pure helpers shared with clients.

export { isReservedTeamRoot, isTeamPath } from './paths';

// `/Team` and `/Team/%` are literal patterns with no LIKE metacharacters, so
// they need no escaping — the Team path is a fixed constant, never user input.
const TEAM_SUBTREE_LIKE = `${TEAM_FOLDER_PATH}/%`;

/**
 * Visibility predicate for a `file` row: the viewer created it, or it lives in
 * the Team subtree. Applied UNCONDITIONALLY to every file read (browse, search,
 * facet, counts) — search and facet drop folder scope, so without this predicate
 * search would leak teammates' private files.
 */
export function fileVisibleTo(viewerId: string): SQL {
  return sql`(${file.createdByUserId} = ${viewerId} or ${file.folderPath} = ${TEAM_FOLDER_PATH} or ${file.folderPath} like ${TEAM_SUBTREE_LIKE})`;
}

// Own file ancestors stay navigable even when a teammate created the folder first.
export function folderVisibleTo(viewerId: string): SQL {
  return sql`(${folder.createdByUserId} = ${viewerId}
    or ${folder.path} = ${CHAT_UPLOADS_FOLDER_PATH}
    or ${folder.path} = ${TEAM_FOLDER_PATH}
    or ${folder.path} like ${TEAM_SUBTREE_LIKE}
    or exists (select 1 from ${file}
      where ${file.workspaceId} = ${folder.workspaceId}
        and ${file.createdByUserId} = ${viewerId}
        and ${file.deletedAt} is null
        and (${file.folderPath} = ${folder.path}
          or starts_with(${file.folderPath}, ${folder.path} || '/'))))`;
}

export function folderWritableBy(viewerId: string): SQL {
  return sql`(${folder.createdByUserId} = ${viewerId}
    or ${folder.path} = ${CHAT_UPLOADS_FOLDER_PATH}
    or ${folder.path} = ${TEAM_FOLDER_PATH}
    or ${folder.path} like ${TEAM_SUBTREE_LIKE})`;
}

// Agent output folders take every member's files; control of them still follows folderWritableBy.
function folderAcceptsWritesFrom(viewerId: string): SQL {
  return sql`(${folderWritableBy(viewerId)} or ${inArray(folder.path, [...AGENT_OUTPUT_FOLDER_PATHS])})`;
}

/**
 * Refuse a write into `path` while any live folder on it, the path itself included,
 * belongs to a teammate. Otherwise a teammate's file would lock the owner out of
 * renaming, moving or deleting her folder.
 */
export async function refuseTeammateFoldersOnPath(
  connection: DbTransaction | typeof db,
  actor: { workspaceId: string; userId: string },
  path: string,
): Promise<void> {
  const segments: string[] = [];
  for (let current = path; current !== ROOT; current = parentPath(current)) {
    segments.push(current);
  }
  if (segments.length === 0) return;
  const blocked = (
    await connection
      .select({ path: folder.path })
      .from(folder)
      .where(
        and(
          eq(folder.workspaceId, actor.workspaceId),
          isNull(folder.deletedAt),
          inArray(folder.path, segments),
          not(folderAcceptsWritesFrom(actor.userId)),
        ),
      )
      .limit(1)
  ).at(0);
  if (blocked) {
    throw new AppError(
      'TOOL_INPUT_INVALID',
      'This folder belongs to a teammate, so nothing can be added to it.',
      { path, blockedPath: blocked.path },
    );
  }
}

/** The live folder at `path` when the actor may rename, move or delete it. */
export function writableFolderRow(
  connection: DbTransaction | typeof db,
  actor: { workspaceId: string; userId: string },
  path: string,
) {
  return connection
    .select({ id: folder.id, createdAt: folder.createdAt })
    .from(folder)
    .where(
      and(
        eq(folder.workspaceId, actor.workspaceId),
        eq(folder.path, path),
        isNull(folder.deletedAt),
        folderWritableBy(actor.userId),
      ),
    )
    .limit(1);
}

// Navigating an ancestor of one's file does not grant control over that folder.
export async function requireWritableFolder(
  workspaceId: string,
  userId: string,
  path: string,
): Promise<void> {
  const row = (await writableFolderRow(db, { workspaceId, userId }, path)).at(0);
  if (!row) {
    throw new AppError('TOOL_INPUT_INVALID', 'folder not found', { path });
  }
}

/**
 * Ensure the workspace's Team folder row exists. Idempotent: any read or write
 * touching the Team subtree calls this so the shared folder is real (navigable,
 * a valid move target). The creator carries no meaning — the acting user is fine
 * — because visibility follows the path, not the creator. Races are harmless:
 * the partial unique index (workspace_id, path) WHERE deleted_at IS NULL turns a
 * concurrent insert into a no-op.
 */
export async function ensureTeamFolder(workspaceId: string, userId: string): Promise<void> {
  await db
    .insert(folder)
    .values({ workspaceId, path: TEAM_FOLDER_PATH, createdByUserId: userId })
    .onConflictDoNothing({
      target: [folder.workspaceId, folder.path],
      where: isNull(folder.deletedAt),
    });
}
