'use server';

import { and, eq, inArray, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '@/db';
import { file, folder } from '@/db/schema';
import { runAction } from '@/lib/action-state';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { FILES_ACTION } from '../constants';
import { fileIdsInput, folderPathInput, parseActionInput } from '../lib/action-input';
import {
  basename,
  isValidFolderPath,
  isWithin,
  joinPath,
  normalizeFolderPath,
  ROOT,
} from '../lib/paths';
import {
  ensureTeamFolder,
  fileVisibleTo,
  folderVisibleTo,
  isReservedTeamRoot,
  refuseTeammateFoldersOnPath,
  requireWritableFolder,
} from '../lib/team-folder';
import type { ActionResult } from '../types';
import { rewriteFolderSubtree } from './folder-subtree';

// Move rewrites folder_path in the metadata mirror, not the immutable storage key.
// All file reads resolve through that mirror.

/** Move files into `target` (an existing folder path or the root). */
export async function moveFiles(
  fileIds: string[],
  targetPath: string,
): Promise<ActionResult<{ moved: number }>> {
  return runAction({ ...FILES_ACTION, route: 'files/move', op: 'move' }, async () => {
    const ids = parseActionInput(fileIdsInput, fileIds, 'invalid file selection');
    const target = parseActionInput(folderPathInput, targetPath, 'invalid target folder');
    const { workspaceId, userId } = await resolveCaller(await headers());
    const to = await requireLiveFolder(workspaceId, userId, target);

    // You can only move files you can see: your own or ones already in Team.
    // Visibility follows the path, not the mover, so a file dragged out of Team
    // keeps its createdByUserId and simply becomes private to its creator again.
    const moved = await db
      .update(file)
      .set({ folderPath: to })
      .where(
        and(
          eq(file.workspaceId, workspaceId),
          isNull(file.deletedAt),
          inArray(file.id, ids),
          fileVisibleTo(userId),
        ),
      )
      .returning({ id: file.id });
    return { moved: moved.length };
  });
}

/** Move a folder (and its whole subtree) under a new parent. */
export async function moveFolder(
  folderPath: string,
  targetParentPath: string,
): Promise<ActionResult<{ path: string }>> {
  return runAction({ ...FILES_ACTION, route: 'files/folders/move', op: 'move' }, async () => {
    const path = parseActionInput(folderPathInput, folderPath, 'cannot move this folder');
    const targetParent = parseActionInput(
      folderPathInput,
      targetParentPath,
      'invalid target folder',
    );
    const { workspaceId, userId } = await resolveCaller(await headers());
    const from = normalizeFolderPath(path);
    if (from === null || from === ROOT) {
      throw new AppError('TOOL_INPUT_INVALID', 'cannot move this folder', { path });
    }
    if (isReservedTeamRoot(from)) {
      throw new AppError('TOOL_INPUT_INVALID', 'The Team folder cannot be moved', { path });
    }
    // You can only move a folder you control (your own, or a Team subfolder) —
    // otherwise a member could move another member's private folder into /Team
    // and expose its whole subtree to the workspace.
    await requireWritableFolder(workspaceId, userId, from);
    const parent = await requireLiveFolder(workspaceId, userId, targetParent);
    if (isWithin(from, parent)) {
      throw new AppError('TOOL_INPUT_INVALID', 'cannot move a folder into itself', {
        path: from,
        target: parent,
      });
    }
    const to = joinPath(parent, basename(from));
    // A move must never usurp the reserved Team folder at root.
    if (isReservedTeamRoot(to)) {
      throw new AppError('TOOL_INPUT_INVALID', 'Team is a reserved folder name', { path: to });
    }
    if (to === from) return { path: from };

    const moved = await rewriteFolderSubtree(
      { workspaceId, userId },
      from,
      to,
      'a folder with that name already exists there',
    );
    if (!moved) throw new AppError('TOOL_INPUT_INVALID', 'folder not found', { path: from });

    return { path: to };
  });
}

/** Resolve + validate a move target: root always exists; anything else must be a
    live folder the caller can see, with no teammate's private folder on its path. */
async function requireLiveFolder(
  workspaceId: string,
  userId: string,
  target: string,
): Promise<string> {
  const normalized = normalizeFolderPath(target);
  if (normalized === null || !isValidFolderPath(normalized)) {
    throw new AppError('TOOL_INPUT_INVALID', 'invalid target folder', { target });
  }
  if (normalized === ROOT) return normalized;
  // Moving into the shared Team folder lazily ensures its row exists first, so a
  // brand-new workspace can share before anyone has opened the Library page.
  if (isReservedTeamRoot(normalized)) {
    await ensureTeamFolder(workspaceId, userId);
    return normalized;
  }
  const existing = (
    await db
      .select({ id: folder.id })
      .from(folder)
      .where(
        and(
          eq(folder.workspaceId, workspaceId),
          eq(folder.path, normalized),
          isNull(folder.deletedAt),
          folderVisibleTo(userId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!existing) {
    throw new AppError('TOOL_INPUT_INVALID', 'target folder not found', { target: normalized });
  }
  await refuseTeammateFoldersOnPath(db, { workspaceId, userId }, normalized);
  return normalized;
}
