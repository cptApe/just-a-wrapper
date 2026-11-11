'use server';

import { and, eq, isNull } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '@/db';
import { folder } from '@/db/schema';
import { runAction } from '@/lib/action-state';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { FILES_ACTION } from '../constants';
import { folderPathInput, nameInput, parseActionInput } from '../lib/action-input';
import {
  isValidFolderPath,
  isValidSegment,
  joinPath,
  normalizeFolderPath,
  parentPath,
  ROOT,
} from '../lib/paths';
import {
  ensureTeamFolder,
  isReservedTeamRoot,
  isTeamPath,
  refuseTeammateFoldersOnPath,
  requireWritableFolder,
} from '../lib/team-folder';
import type { ActionResult } from '../types';
import { rewriteFolderSubtree, trashFolderSubtree } from './folder-subtree';

// Folder CRUD over the OUR-DB folder mirror (see schema/folder.ts for why folders
// live in Postgres because stored keys never move). Arbitrary nesting. Rename and delete
// operate on the whole subtree in one transaction so files never orphan.

/** Create a new folder named `name` inside `parent`. */
export async function createFolder(
  parentPath: string,
  folderName: string,
): Promise<ActionResult<{ path: string }>> {
  return runAction({ ...FILES_ACTION, route: 'files/folders/create', op: 'create' }, async () => {
    const parent = parseActionInput(folderPathInput, parentPath, 'invalid parent folder path');
    const name = parseActionInput(nameInput, folderName, 'invalid folder name');
    const { workspaceId, userId } = await resolveCaller(await headers());
    const parentPathNorm = normalizeFolderPath(parent);
    if (parentPathNorm === null) {
      throw new AppError('TOOL_INPUT_INVALID', 'invalid parent folder path', { parent });
    }
    if (!isValidSegment(name)) {
      throw new AppError('TOOL_INPUT_INVALID', 'invalid folder name', { name });
    }
    const path = joinPath(parentPathNorm, name.trim());

    // Team is the reserved shared folder — you can't create a second one at root.
    // Subfolders INSIDE /Team are normal (that space is genuinely shared).
    if (isReservedTeamRoot(path)) {
      throw new AppError('TOOL_INPUT_INVALID', 'Team is a reserved folder name', { path });
    }
    // Creating inside the Team subtree ensures the shared root row exists first.
    if (isTeamPath(parentPathNorm)) await ensureTeamFolder(workspaceId, userId);
    await refuseTeammateFoldersOnPath(db, { workspaceId, userId }, parentPathNorm);

    // Reject duplicates with a friendly error before hitting the unique index.
    const existing = await db
      .select({ id: folder.id })
      .from(folder)
      .where(
        and(eq(folder.workspaceId, workspaceId), eq(folder.path, path), isNull(folder.deletedAt)),
      )
      .limit(1);
    if (existing.length > 0) {
      throw new AppError('TOOL_INPUT_INVALID', 'a folder with that name already exists here', {
        path,
      });
    }

    await db.insert(folder).values({ workspaceId, path, createdByUserId: userId });
    return { path };
  });
}

/** Rename a folder (and rewrite every descendant folder + contained file path). */
export async function renameFolder(
  folderPath: string,
  name: string,
): Promise<ActionResult<{ path: string }>> {
  return runAction({ ...FILES_ACTION, route: 'files/folders/rename', op: 'rename' }, async () => {
    const path = parseActionInput(folderPathInput, folderPath, 'cannot rename this folder');
    const newName = parseActionInput(nameInput, name, 'invalid folder name');
    const { workspaceId, userId } = await resolveCaller(await headers());
    const from = normalizeFolderPath(path);
    if (from === null || from === ROOT) {
      throw new AppError('TOOL_INPUT_INVALID', 'cannot rename this folder', { path });
    }
    if (isReservedTeamRoot(from)) {
      throw new AppError('TOOL_INPUT_INVALID', 'The Team folder cannot be renamed', { path });
    }
    // You can only rename a folder you control (your own, or a Team subfolder).
    await requireWritableFolder(workspaceId, userId, from);
    if (!isValidSegment(newName)) {
      throw new AppError('TOOL_INPUT_INVALID', 'invalid folder name', { newName });
    }
    const to = joinPath(parentPath(from), newName.trim());
    // A rename must never usurp the reserved Team folder at root.
    if (isReservedTeamRoot(to)) {
      throw new AppError('TOOL_INPUT_INVALID', 'Team is a reserved folder name', { path: to });
    }
    if (to === from) return { path: from };

    const renamed = await rewriteFolderSubtree(
      { workspaceId, userId },
      from,
      to,
      'a folder with that name already exists here',
    );
    if (!renamed) throw new AppError('TOOL_INPUT_INVALID', 'folder not found', { path: from });

    return { path: to };
  });
}

/** Soft-delete a folder, its descendant folders, and all files within. */
export async function deleteFolder(folderPath: string): Promise<ActionResult<{ removed: number }>> {
  return runAction({ ...FILES_ACTION, route: 'files/folders/delete', op: 'delete' }, async () => {
    const path = parseActionInput(folderPathInput, folderPath, 'cannot delete this folder');
    const { workspaceId, userId } = await resolveCaller(await headers());
    const target = normalizeFolderPath(path);
    if (target === null || target === ROOT) {
      throw new AppError('TOOL_INPUT_INVALID', 'cannot delete this folder', { path });
    }
    if (isReservedTeamRoot(target)) {
      throw new AppError('TOOL_INPUT_INVALID', 'The Team folder cannot be deleted', { path });
    }
    if (!isValidFolderPath(target)) {
      throw new AppError('TOOL_INPUT_INVALID', 'invalid folder path', { path });
    }
    // You can only delete a folder you control (your own, or a Team subfolder).
    await requireWritableFolder(workspaceId, userId, target);

    const removed = await trashFolderSubtree({ workspaceId, userId }, target);
    if (!removed) throw new AppError('TOOL_INPUT_INVALID', 'folder not found', { path: target });

    return { removed: removed.folders };
  });
}
