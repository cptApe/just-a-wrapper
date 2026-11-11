import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { file } from '@/db/schema';
import { getWorkspacePlanTier } from '@/features/billing/api/get-workspace-plan';
import { planLimits } from '@/features/billing/api/plan-limits';
// Direct module import (not the sessions barrel) — only the ownership gate is
// needed here, and the barrel drags the relay/SDK graph into this files module.
import { assertSessionActor } from '@/features/sessions/api/assert-session-actor';
import { authorizeSessionWriteForActor } from '@/features/sessions/api/session-access';
import { captureEvent } from '@/lib/analytics';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { extend } from '@/lib/request-context';
import { isValidSegment } from '../lib/paths';
import { assertFreshUpload } from '../lib/stored-blob-machine';
import { fileVisibleTo } from '../lib/team-folder';
import type { FileEntry } from '../types';
import { attachFileToSession, type MountedSessionFile } from './attach-to-session';
import {
  cleanupBlob,
  createThumbnail,
  inspectBlob,
  readBlobBytes,
  THUMBNAIL_SOURCE_MAX_BYTES,
  THUMBNAIL_TYPES,
} from './blob-storage';
import { linkFileOrigin } from './file-origin-transitions';
import { ensureLibraryFolderPath, visibleLibraryMountFilename } from './library-operations';
import { toFileEntry } from './load';
import { lockShareUploadFolder } from './share-upload-folder';
import type { UploadAccess } from './upload-access';

// The browser writes metadata because upload callbacks cannot reach localhost.
// A chat session ID is our database ID; resolve its visible Anthropic session before mounting.
type RawUpload = {
  storagePath: string;
  originalFileName: string;
};

export type SyncedSessionAttachment = MountedSessionFile & {
  fileId: string;
  name: string;
  durableUrl: string;
};

export type SyncedUpload = {
  file: FileEntry;
};

async function mountStoredFile(args: {
  workspaceId: string;
  userId: string;
  sessionId: string;
  entry: FileEntry;
  storagePath: string;
}): Promise<SyncedSessionAttachment> {
  const owned = await authorizeSessionWriteForActor({
    sessionId: args.sessionId,
    workspaceId: args.workspaceId,
    userId: args.userId,
  });
  await assertSessionActor(owned.sessionRowId, args.userId);
  extend({ session_id: owned.anthropicSessionId });
  const mountFilename = await visibleLibraryMountFilename(
    { workspaceId: args.workspaceId, userId: args.userId },
    {
      id: args.entry.id,
      filename: args.entry.filename,
      folderPath: args.entry.folderPath,
      mimeType: args.entry.mimeType,
      sizeBytes: args.entry.sizeBytes,
      storagePath: args.storagePath,
    },
  );
  const mounted = await attachFileToSession({
    sessionRowId: owned.sessionRowId,
    fileId: args.entry.id,
    sessionId: owned.anthropicSessionId,
    filename: args.entry.filename,
    mountFilename,
    mimeType: args.entry.mimeType,
    workspaceId: args.workspaceId,
    storagePath: args.storagePath,
    sourceSizeBytes: args.entry.sizeBytes,
  });
  const attachment = {
    ...mounted,
    fileId: args.entry.id,
    name: args.entry.filename,
    durableUrl: args.entry.url,
  };
  switch (await linkFileOrigin(args.entry.id, owned.sessionRowId)) {
    case 'linked':
    case 'unchanged':
      return attachment;
  }
}

type InsertArgs = {
  workspaceId: string;
  createdByUserId: string;
  source: 'user_upload' | 'agent_generated' | 'session_output';
  folderPath: string;
  filename: string;
  storagePath: string;
  shareId: string | null;
};

function displayFilename(originalFileName: string): string {
  const trimmed = originalFileName.trim();
  if (!isValidSegment(trimmed)) throw new AppError('VALIDATION_FAILED', 'Invalid file name.', {});
  return trimmed;
}

async function insertFileRow(args: InsertArgs): Promise<FileEntry> {
  const metadata = await inspectBlob(args.storagePath);
  assertFreshUpload(metadata.uploadedAt, new Date());
  const plan = await getWorkspacePlanTier(args.workspaceId);
  if (!plan)
    throw new AppError('WORKSPACE_NOT_FOUND', 'Workspace not found.', {
      workspaceId: args.workspaceId,
    });
  if (metadata.size > (await planLimits(plan)).fileSizeBytes)
    throw new AppError('PLAN_LIMIT_REACHED', 'File exceeds the size limit.', {
      workspaceId: args.workspaceId,
    });
  const fileId = randomUUID();
  let thumbnailPath: string | null = null;
  if (
    THUMBNAIL_TYPES.includes(metadata.contentType) &&
    metadata.size <= THUMBNAIL_SOURCE_MAX_BYTES
  ) {
    try {
      thumbnailPath = await createThumbnail({
        workspaceId: args.workspaceId,
        fileId,
        bytes: await readBlobBytes(args.storagePath, THUMBNAIL_SOURCE_MAX_BYTES),
        mimeType: metadata.contentType,
      });
    } catch (cause) {
      // A preview read failure must not discard an otherwise valid Library upload.
      captureException(cause, { fileId, operation: 'thumbnail-read' });
    }
  }
  try {
    assertFreshUpload(metadata.uploadedAt, new Date());
    const row = (
      await db.transaction(async (tx) => {
        if (args.shareId !== null) await lockShareUploadFolder(tx, args.shareId, args.folderPath);
        return tx
          .insert(file)
          .values({
            id: fileId,
            thumbnailPath,
            workspaceId: args.workspaceId,
            createdByUserId: args.createdByUserId,
            source: args.source,

            storagePath: args.storagePath,
            folderPath: args.folderPath,
            filename: args.filename,
            mimeType: metadata.contentType,
            sizeBytes: metadata.size,
          })
          .returning();
      })
    ).at(0);

    if (!row) throw new AppError('UNEXPECTED', 'File insert returned no row.', {});
    return toFileEntry(row);
  } catch (cause) {
    // A preview without a file row is an orphan, so failed inserts remove it.
    if (thumbnailPath) await cleanupBlob(thumbnailPath);
    throw cause;
  }
}

// Save the upload independently of session attachment so mounting can retry by file ID.
export async function syncUploadedFile(args: {
  actor: Pick<Extract<UploadAccess, { kind: 'member' }>, 'workspaceId' | 'userId'>;
  folderPath: string;
  upload: RawUpload;
  uploadSource: 'chat' | 'library';
}): Promise<SyncedUpload> {
  // Composer uploads land in /Chat uploads. Persist the folder row (and any
  // intermediate rows for future callers) so the Library UI can navigate to it;
  // a file row alone is not enough for loadFolders.
  await ensureLibraryFolderPath(
    { workspaceId: args.actor.workspaceId, userId: args.actor.userId },
    args.folderPath,
  );
  const entry = await insertFileRow({
    workspaceId: args.actor.workspaceId,
    createdByUserId: args.actor.userId,
    source: 'user_upload',
    shareId: null,
    folderPath: args.folderPath,
    filename: displayFilename(args.upload.originalFileName),
    storagePath: args.upload.storagePath,
  });
  captureEvent(
    'file:upload',
    {
      file_id: entry.id,
      mime_type: entry.mimeType,
      size_bytes: entry.sizeBytes,
      upload_source: args.uploadSource,
    },
    { userId: args.actor.userId, workspaceId: args.actor.workspaceId },
  );

  return { file: entry };
}

/** Re-mount a browser upload already persisted in Library without inserting it again. */
export async function attachExistingUploadedFile(args: {
  workspaceId: string;
  userId: string;
  sessionId: string;
  fileId: string;
  clientSizeBytes: number;
}): Promise<SyncedSessionAttachment> {
  const row = (
    await db
      .select()
      .from(file)
      .where(
        and(
          eq(file.id, args.fileId),
          eq(file.workspaceId, args.workspaceId),
          isNull(file.deletedAt),
          fileVisibleTo(args.userId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!row) {
    throw new AppError('TOOL_INPUT_INVALID', 'The attached file no longer exists.', {
      fileId: args.fileId,
      expectedState: true,
    });
  }
  if (args.clientSizeBytes !== row.sizeBytes) {
    throw new AppError('VALIDATION_FAILED', 'The attached file size changed during upload.', {
      clientSizeBytes: args.clientSizeBytes,
      sourceSizeBytes: row.sizeBytes,
      filename: row.filename,
      expectedState: true,
    });
  }
  return mountStoredFile({
    workspaceId: args.workspaceId,
    userId: args.userId,
    sessionId: args.sessionId,
    storagePath: row.storagePath,
    entry: toFileEntry(row),
  });
}

// Anonymous edit-link uploads are attributed to the share's creator.
export async function syncSharedUpload(args: {
  actor: Extract<UploadAccess, { kind: 'share' }>;
  folderPath: string;
  upload: RawUpload;
}): Promise<FileEntry> {
  const { share } = args.actor;
  const entry = await insertFileRow({
    workspaceId: share.workspaceId,
    createdByUserId: share.createdByUserId,
    source: 'user_upload',
    shareId: share.id,
    folderPath: args.folderPath,
    filename: displayFilename(args.upload.originalFileName),
    storagePath: args.upload.storagePath,
  });
  // Anonymous edit-link uploads are attributed to the share's creator.
  captureEvent(
    'file:upload',
    {
      file_id: entry.id,
      mime_type: entry.mimeType,
      size_bytes: entry.sizeBytes,
      upload_source: 'share_link',
    },
    { userId: share.createdByUserId, workspaceId: share.workspaceId },
  );
  return entry;
}
