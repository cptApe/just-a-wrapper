'use server';

import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '@/db';
import { file, folder } from '@/db/schema';
import { runAction } from '@/lib/action-state';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { FILES_ACTION } from '../constants';
import { fileIdsInput, folderIdInput, parseActionInput } from '../lib/action-input';
import { insidePath } from '../lib/path-sql';
import { parentPath, ROOT } from '../lib/paths';
import { fileVisibleTo, folderWritableBy } from '../lib/team-folder';
import { trashCutoff, trashState } from '../lib/trash-machine';
import type { ActionResult } from '../types';
import { transitionFiles, transitionFolders } from './trash-transitions';

// Restore clears deleted_at. A file restore revives its parent chain.
// A folder restore revives only rows sharing its deletion timestamp, preserving
// items deleted independently.

export async function restoreFiles(fileIds: string[]): Promise<ActionResult<{ restored: number }>> {
  return runAction({ ...FILES_ACTION, route: 'files/restore', op: 'restore' }, async () => {
    const ids = parseActionInput(fileIdsInput, fileIds, 'invalid file selection');
    const { workspaceId, userId } = await resolveCaller(await headers());

    const restored = await db.transaction(async (tx) => {
      const rows = await transitionFiles(
        tx,
        and(eq(file.workspaceId, workspaceId), fileVisibleTo(userId), inArray(file.id, ids)),
        null,
      );

      // Revive each restored file's folder chain.
      const chains = new Set<string>();
      for (const row of rows) {
        let path = row.folderPath;
        while (path !== ROOT) {
          chains.add(path);
          path = parentPath(path);
        }
      }
      for (const path of chains) {
        const existing = (
          await tx
            .select({ id: folder.id, deletedAt: folder.deletedAt })
            .from(folder)
            .where(and(eq(folder.workspaceId, workspaceId), eq(folder.path, path)))
            .orderBy(sql`${folder.deletedAt} desc nulls first`)
            .limit(1)
        ).at(0);
        if (!existing || trashState(existing.deletedAt, new Date()) === 'expired') {
          await tx.insert(folder).values({ workspaceId, path, createdByUserId: userId });
        } else if (existing.deletedAt !== null) {
          await transitionFolders(tx, eq(folder.id, existing.id), null);
        }
      }
      return rows.length;
    });

    return { restored };
  });
}

export async function restoreFolder(id: string): Promise<ActionResult<{ restored: number }>> {
  return runAction({ ...FILES_ACTION, route: 'files/folders/restore', op: 'restore' }, async () => {
    const folderId = parseActionInput(folderIdInput, id, 'folder not found in Recently deleted');
    const { workspaceId, userId } = await resolveCaller(await headers());
    const restored = await db.transaction(async (tx) => {
      const root = (
        await tx
          .select({ id: folder.id, path: folder.path, deletedAt: folder.deletedAt })
          .from(folder)
          .where(
            and(
              eq(folder.workspaceId, workspaceId),
              eq(folder.id, folderId),
              gt(folder.deletedAt, trashCutoff(new Date())),
              folderWritableBy(userId),
            ),
          )
          .limit(1)
      ).at(0);
      if (!root || root.deletedAt === null) {
        throw new AppError('TOOL_INPUT_INVALID', 'folder not found in Recently deleted', {
          folderId,
        });
      }
      const target = root.path;

      // A live folder re-created at the same path since the delete would
      // collide with the partial unique index — surface it as a friendly error.
      const collision = (
        await tx
          .select({ id: folder.id })
          .from(folder)
          .where(
            and(
              eq(folder.workspaceId, workspaceId),
              eq(folder.path, target),
              isNull(folder.deletedAt),
            ),
          )
          .limit(1)
      ).at(0);
      if (collision) {
        throw new AppError('TOOL_INPUT_INVALID', 'a folder with that name already exists here', {
          path: target,
        });
      }

      // Everything stamped with the same deleted_at died in the same subtree
      // delete — restore it together; independently-deleted items stay put.
      const subtreeFolders = await transitionFolders(
        tx,
        and(
          eq(folder.workspaceId, workspaceId),
          eq(folder.deletedAt, root.deletedAt),
          folderWritableBy(userId),
          insidePath(folder.path, target),
        ),
        null,
      );
      await transitionFiles(
        tx,
        and(
          eq(file.workspaceId, workspaceId),
          eq(file.deletedAt, root.deletedAt),
          fileVisibleTo(userId),
          insidePath(file.folderPath, target),
        ),
        null,
      );

      // Revive the parent chain so the restored folder is reachable.
      let parent = parentPath(target);
      while (parent !== ROOT) {
        const existing = (
          await tx
            .select({ id: folder.id, deletedAt: folder.deletedAt })
            .from(folder)
            .where(and(eq(folder.workspaceId, workspaceId), eq(folder.path, parent)))
            .orderBy(sql`${folder.deletedAt} desc nulls first`)
            .limit(1)
        ).at(0);
        if (!existing || trashState(existing.deletedAt, new Date()) === 'expired') {
          await tx.insert(folder).values({ workspaceId, path: parent, createdByUserId: userId });
        } else if (existing.deletedAt !== null) {
          await transitionFolders(tx, eq(folder.id, existing.id), null);
        }
        parent = parentPath(parent);
      }

      return subtreeFolders.length;
    });

    return { restored };
  });
}
