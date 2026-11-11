import 'server-only';
import { and, eq, gte, isNull, not, or, sql } from 'drizzle-orm';
import { type DbTransaction, db } from '@/db';
import { file, folder } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { insidePath } from '../lib/path-sql';
import { parentPath } from '../lib/paths';
import { fileVisibleTo, refuseTeammateFoldersOnPath, writableFolderRow } from '../lib/team-folder';
import type { LibraryActor } from './library-operations';
import { transitionFiles, transitionFolders } from './trash-transitions';

// Rename, move and delete of a folder subtree for the Library UI and the agent verbs.
// Each write carries the same file visibility predicate as its guard, so a teammate
// file that lands after the guard is left in place, never moved or trashed.

/**
 * Rewrite the `from` subtree to `to`. Returns false when the actor cannot write a live
 * folder at `from`. Trashed descendants newer than the folder move with it, so they
 * restore to the new path.
 */
export async function rewriteFolderSubtree(
  actor: LibraryActor,
  from: string,
  to: string,
  collisionMessage: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const source = (await writableFolderRow(tx, actor, from).for('update')).at(0);
    if (!source) return false;
    await refuseTeammateFoldersOnPath(tx, actor, parentPath(to));
    await refuseHiddenFilesInSubtree(tx, actor, from, 'moved');
    const collision = (
      await tx
        .select({ id: folder.id })
        .from(folder)
        .where(
          and(
            eq(folder.workspaceId, actor.workspaceId),
            eq(folder.path, to),
            isNull(folder.deletedAt),
          ),
        )
        .limit(1)
    ).at(0);
    if (collision) throw new AppError('TOOL_INPUT_INVALID', collisionMessage, { path: to });

    await tx
      .update(folder)
      .set({ path: sql`${to}::text || substr(${folder.path}, char_length(${from}::text) + 1)` })
      .where(
        and(
          eq(folder.workspaceId, actor.workspaceId),
          or(isNull(folder.deletedAt), gte(folder.deletedAt, source.createdAt)),
          insidePath(folder.path, from),
        ),
      );
    await tx
      .update(file)
      .set({
        folderPath: sql`${to}::text || substr(${file.folderPath}, char_length(${from}::text) + 1)`,
      })
      .where(
        and(
          eq(file.workspaceId, actor.workspaceId),
          or(isNull(file.deletedAt), gte(file.deletedAt, source.createdAt)),
          insidePath(file.folderPath, from),
          fileVisibleTo(actor.userId),
        ),
      );
    return true;
  });
}

/** Trash the `path` subtree with one timestamp so restore revives it together. */
export async function trashFolderSubtree(
  actor: LibraryActor,
  path: string,
): Promise<{ folders: number; files: number } | null> {
  return db.transaction(async (tx) => {
    const source = (await writableFolderRow(tx, actor, path).for('update')).at(0);
    if (!source) return null;
    await refuseHiddenFilesInSubtree(tx, actor, path, 'deleted');
    const now = new Date();
    const folders = await transitionFolders(
      tx,
      and(
        eq(folder.workspaceId, actor.workspaceId),
        isNull(folder.deletedAt),
        insidePath(folder.path, path),
      ),
      now,
    );
    const files = await transitionFiles(
      tx,
      and(
        eq(file.workspaceId, actor.workspaceId),
        isNull(file.deletedAt),
        insidePath(file.folderPath, path),
        fileVisibleTo(actor.userId),
      ),
      now,
    );
    return { folders: folders.length, files: files.length };
  });
}

async function refuseHiddenFilesInSubtree(
  tx: DbTransaction,
  actor: LibraryActor,
  path: string,
  operation: 'moved' | 'deleted',
): Promise<void> {
  const hidden = (
    await tx
      .select({ id: file.id })
      .from(file)
      .where(
        and(
          eq(file.workspaceId, actor.workspaceId),
          insidePath(file.folderPath, path),
          not(fileVisibleTo(actor.userId)),
          ...(operation === 'deleted' ? [isNull(file.deletedAt)] : []),
        ),
      )
      .limit(1)
  ).at(0);
  if (hidden) {
    throw new AppError(
      'TOOL_INPUT_INVALID',
      `This folder contains a teammate's files, so it cannot be ${operation}.`,
      { path },
    );
  }
}
