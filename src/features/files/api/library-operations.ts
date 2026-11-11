import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { file, folder } from '@/db/schema';
import { AppError } from '@/lib/errors';
import {
  basename,
  isReservedTeamRoot,
  isValidSegment,
  isWithin,
  joinPath,
  normalizeFolderPath,
  parentPath,
  ROOT,
} from '../lib/paths';
import {
  ensureTeamFolder,
  fileVisibleTo,
  refuseTeammateFoldersOnPath,
  writableFolderRow,
} from '../lib/team-folder';
import { rewriteFolderSubtree, trashFolderSubtree } from './folder-subtree';
import { transitionFiles } from './trash-transitions';

export type LibraryActor = { workspaceId: string; userId: string };

export type LibraryFileRecord = {
  id: string;
  filename: string;
  folderPath: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
};

export async function findVisibleLibraryFile(
  actor: LibraryActor,
  path: string,
): Promise<LibraryFileRecord | null> {
  const normalized = normalizeFolderPath(path);
  if (normalized === null || normalized === ROOT) return null;
  const rows = await db
    .select({
      id: file.id,
      filename: file.filename,
      folderPath: file.folderPath,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      storagePath: file.storagePath,
    })
    .from(file)
    .where(
      and(
        eq(file.workspaceId, actor.workspaceId),
        eq(file.folderPath, parentPath(normalized)),
        eq(file.filename, basename(normalized)),
        isNull(file.deletedAt),
        fileVisibleTo(actor.userId),
      ),
    )
    .orderBy(asc(file.createdAt), asc(file.id))
    .limit(2);
  if (rows.length > 1) {
    throw new AppError(
      'TOOL_INPUT_INVALID',
      'Library path matches multiple files. Rename the duplicate files in the Library before using this path.',
      { path },
    );
  }
  return rows.at(0) ?? null;
}

export async function visibleLibraryMountFilename(
  actor: LibraryActor,
  record: LibraryFileRecord,
): Promise<string> {
  const rows = await db
    .select({ id: file.id })
    .from(file)
    .where(
      and(
        eq(file.workspaceId, actor.workspaceId),
        eq(file.filename, record.filename),
        isNull(file.deletedAt),
        fileVisibleTo(actor.userId),
      ),
    )
    .orderBy(asc(file.createdAt), asc(file.id));
  const index = rows.findIndex((row) => row.id === record.id);
  if (index <= 0) return record.filename;
  const dot = record.filename.lastIndexOf('.');
  return dot <= 0
    ? `${record.filename} (${index + 1})`
    : `${record.filename.slice(0, dot)} (${index + 1})${record.filename.slice(dot)}`;
}

/** mkdir -p over the workspace path namespace. Every live folder on the path must
 * accept the actor's writes, so a file never lands in a teammate's private folder. */
export async function ensureLibraryFolderPath(
  actor: LibraryActor,
  rawPath: string,
): Promise<string> {
  const path = normalizeFolderPath(rawPath);
  if (path === null) {
    throw new AppError('TOOL_INPUT_INVALID', 'invalid folder path', { path: rawPath });
  }
  if (path === ROOT) return ROOT;
  await refuseTeammateFoldersOnPath(db, actor, path);

  const segments = path.slice(1).split('/');
  let current = ROOT;
  for (const segment of segments) {
    current = joinPath(current, segment);
    if (isReservedTeamRoot(current)) {
      await ensureTeamFolder(actor.workspaceId, actor.userId);
      continue;
    }
    await db
      .insert(folder)
      .values({ workspaceId: actor.workspaceId, path: current, createdByUserId: actor.userId })
      .onConflictDoNothing({
        target: [folder.workspaceId, folder.path],
        where: isNull(folder.deletedAt),
      });

    const live = (
      await db
        .select({ id: folder.id })
        .from(folder)
        .where(
          and(
            eq(folder.workspaceId, actor.workspaceId),
            eq(folder.path, current),
            isNull(folder.deletedAt),
          ),
        )
        .limit(1)
    ).at(0);
    if (!live) {
      throw new AppError('TOOL_INPUT_INVALID', 'folder not found', { path: current });
    }
  }
  return path;
}

export async function moveVisibleLibraryItem(
  actor: LibraryActor,
  fromRaw: string,
  toRaw: string,
): Promise<{ kind: 'file' | 'folder'; path: string } | null> {
  const from = normalizeFolderPath(fromRaw);
  const to = normalizeFolderPath(toRaw);
  if (
    from === null ||
    to === null ||
    from === ROOT ||
    to === ROOT ||
    !isValidSegment(basename(to))
  ) {
    throw new AppError('TOOL_INPUT_INVALID', 'invalid Library path', { from: fromRaw, to: toRaw });
  }

  const sourceFile = await findVisibleLibraryFile(actor, from);
  if (sourceFile) {
    await ensureLibraryFolderPath(actor, parentPath(to));
    const destinationFile = await findVisibleLibraryFile(actor, to);
    if (destinationFile && destinationFile.id !== sourceFile.id) {
      throw new AppError('TOOL_INPUT_INVALID', 'a file already exists at the destination', { to });
    }
    await db
      .update(file)
      .set({ folderPath: parentPath(to), filename: basename(to) })
      .where(
        and(
          eq(file.id, sourceFile.id),
          eq(file.workspaceId, actor.workspaceId),
          isNull(file.deletedAt),
          fileVisibleTo(actor.userId),
        ),
      );
    return { kind: 'file', path: to };
  }

  if (isReservedTeamRoot(from) || isReservedTeamRoot(to) || isWithin(from, to)) {
    throw new AppError('TOOL_INPUT_INVALID', 'cannot move this folder', { from, to });
  }
  // Look up the source before ensuring the destination, so a miss creates no folders.
  if ((await writableFolderRow(db, actor, from)).length === 0) return null;
  await ensureLibraryFolderPath(actor, parentPath(to));
  const moved = await rewriteFolderSubtree(
    actor,
    from,
    to,
    'a folder already exists at the destination',
  );
  return moved ? { kind: 'folder', path: to } : null;
}

export async function deleteVisibleLibraryItem(
  actor: LibraryActor,
  rawPath: string,
): Promise<{ kind: 'file' | 'folder'; removed: number } | null> {
  const path = normalizeFolderPath(rawPath);
  if (path === null || path === ROOT) {
    throw new AppError('TOOL_INPUT_INVALID', 'cannot delete this Library path', { path: rawPath });
  }
  const sourceFile = await findVisibleLibraryFile(actor, path);
  if (sourceFile) {
    const rows = await transitionFiles(
      db,
      and(
        eq(file.id, sourceFile.id),
        eq(file.workspaceId, actor.workspaceId),
        isNull(file.deletedAt),
        fileVisibleTo(actor.userId),
      ),
      new Date(),
    );
    return rows.length === 0 ? null : { kind: 'file', removed: rows.length };
  }
  if (isReservedTeamRoot(path)) {
    throw new AppError('TOOL_INPUT_INVALID', 'The Team folder cannot be deleted', { path });
  }
  const removed = await trashFolderSubtree(actor, path);
  return removed === null ? null : { kind: 'folder', removed: removed.folders + removed.files };
}
