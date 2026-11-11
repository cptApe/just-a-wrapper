import 'server-only';
import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import { file } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { storagePathFor } from '../lib/paths';
import { requireUploadPath } from '../lib/upload-policy';
import type { FileEntry } from '../types';
import { cleanupBlob, createThumbnail, writeBlob } from './blob-storage';
import { ensureLibraryFolderPath } from './library-operations';
import { toFileEntry } from './load';

export type ImportDriveFileInput = {
  workspaceId: string;
  userId: string;
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
  mimeType: string;
  /** Drive folder to land in, e.g. '/Artifacts'. Created (as a row) if absent. */
  folderPath: string;
  source: 'agent_generated' | 'session_output';
  /** Local session row id the file came from, when known. */
  sessionId?: string;
};

export async function importDriveFile(input: ImportDriveFileInput): Promise<FileEntry> {
  // Unique immutable keys let two outputs keep the same display name without overwriting bytes.
  const targetPath = storagePathFor(
    input.workspaceId,
    input.folderPath,
    collisionProofName(input.filename),
  );
  const split = requireUploadPath(input.workspaceId, targetPath, input.folderPath);
  const uploaded = await writeBlob(targetPath, input.bytes, input.mimeType);
  let thumbnailPath: string | null = null;
  try {
    const fileId = randomUUID();
    thumbnailPath = await createThumbnail({
      workspaceId: input.workspaceId,
      fileId,
      bytes: input.bytes,
      mimeType: input.mimeType,
    });
    await ensureLibraryFolderPath(
      { workspaceId: input.workspaceId, userId: input.userId },
      split.folderPath,
    );

    const row = (
      await db
        .insert(file)
        .values({
          id: fileId,
          thumbnailPath,
          workspaceId: input.workspaceId,
          createdByUserId: input.userId,
          source: input.source,
          sessionId: input.sessionId ?? null,
          storagePath: uploaded.pathname,
          folderPath: split.folderPath,
          filename: input.filename,
          mimeType: input.mimeType,
          sizeBytes: input.bytes.byteLength,
        })
        .returning()
    ).at(0);

    if (!row) throw new AppError('UNEXPECTED', 'File insert returned no row.', {});
    return toFileEntry(row);
  } catch (cause) {
    await cleanupBlob(uploaded.pathname);
    if (thumbnailPath !== null) await cleanupBlob(thumbnailPath);
    throw cause;
  }
}

// A full UUID prevents collisions when repeated outputs share a display name.
function collisionProofName(filename: string): string {
  const tag = randomUUID();
  const dot = filename.lastIndexOf('.');
  if (dot <= 0) return `${filename}-${tag}`;
  return `${filename.slice(0, dot)}-${tag}${filename.slice(dot)}`;
}
