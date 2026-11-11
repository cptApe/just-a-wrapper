import type { SyncedSessionAttachment, UploadConfig } from '@/features/files';
import { uploadBrowserFile } from '@/features/files/lib/client-upload';
import type { ComposerLibraryFile } from '@/features/sessions/types';
import { CAPABILITY_OFF_MESSAGES } from '@/lib/capability-messages';
import { AppError, type ErrorCode } from '@/lib/errors';
import { isExpectedUserStateError } from '@/lib/expected-state-error';
import { captureException } from '@/lib/observability-client';
import {
  findCachedAttachment,
  type PreparedAttachment,
  rememberCachedAttachment,
  rememberPersistedAttachment,
} from './attachment-mount-cache';
import {
  readMountedAttachment,
  readSavedLibraryFile,
  readUploadError,
} from './attachment-response';
import { reduceAttachmentUpload } from './attachment-upload-machine';

// Upload when picked; existing chats mount immediately. Home persists to the
// Library first and mounts the cached file once a session exists.

export type PendingAttachment = {
  /** Local identity for list rendering + removal. */
  id: string;
  file: File;
  /** Blob URL for image thumbnails; null for non-images. */
  previewUrl: string | null;
} & (
  | { status: 'local' }
  | { status: 'uploading' }
  | { status: 'ready'; prepared: PreparedAttachment | ComposerLibraryFile }
  | { status: 'failed'; error: string }
);

export type AttachContext = {
  workspaceId: string;
  uploadConfig: UploadConfig;
};

export function createPendingAttachment(file: File): PendingAttachment {
  return {
    id: crypto.randomUUID(),
    status: 'local',
    file,
    previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
  };
}

export function releasePendingAttachment(attachment: PendingAttachment): void {
  if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
}

type PreparedComposerAttachment = SyncedSessionAttachment & PreparedAttachment;

type AttachFailure = {
  name: string;
  code: ErrorCode;
  message: string;
};

export type AttachOutcome = {
  attached: PreparedComposerAttachment[];
  failed: AttachFailure[];
};

const ATTACH_FAILED_MESSAGE = 'The attachment could not be prepared.';

function attachFailure(name: string, error: unknown): AttachFailure {
  if (error instanceof AppError) {
    return { name, code: error.code, message: error.message };
  }
  // A thrown Error here (a blob upload, a dropped connection) carries text written for logs.
  return { name, code: 'API_REQUEST_FAILED', message: ATTACH_FAILED_MESSAGE };
}

export async function uploadAndAttach(
  attachments: PendingAttachment[],
  context: AttachContext | null,
  sessionId: string,
  signal: AbortSignal | undefined,
): Promise<AttachOutcome> {
  if (attachments.length === 0) return { attached: [], failed: [] };
  if (!context?.uploadConfig.enabled) {
    return {
      attached: [],
      failed: attachments.map(({ file }) => ({
        name: file.name,
        code: 'INTEGRATION_NOT_CONNECTED',
        message: CAPABILITY_OFF_MESSAGES.uploads,
      })),
    };
  }

  const outcome: AttachOutcome = { attached: [], failed: [] };
  for (const pending of attachments) {
    let cached = findCachedAttachment(pending.file, sessionId);
    if (!cached) {
      const saved = await uploadFilesToLibrary([pending], context, signal);
      if (saved.failed.length > 0) {
        outcome.failed.push(...saved.failed);
        continue;
      }
      cached = findCachedAttachment(pending.file, sessionId);
    }
    if (cached?.kind === 'mounted') {
      outcome.attached.push(cached.attachment);
      continue;
    }
    const { file } = pending;
    try {
      signal?.throwIfAborted();
      if (cached?.kind === 'persisted') {
        // eslint-disable-next-line no-restricted-syntax -- this boundary needs the route's structured expected-state error and supports the existing-file retry shape
        const remount = await fetch('/api/files/sync-metadata', {
          signal,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            existingFileId: cached.fileId,
            clientSizeBytes: file.size,
            sessionId,
          }),
        });
        if (!remount.ok) {
          const error = await readUploadError(remount);
          throw new AppError(error.code, error.message, {
            op: 'composer-attach-existing',
            sessionId,
            fileName: file.name,
            status: remount.status,
            expectedState: error.expectedState,
          });
        }
        const attachment = readMountedAttachment(
          await remount.json(),
          sessionId,
          file.name,
          'existing',
        );
        rememberCachedAttachment(file, sessionId, attachment);
        outcome.attached.push(attachment);
        continue;
      }
      throw new AppError('UNEXPECTED', 'Saved attachment is missing from the upload cache.', {
        fileName: file.name,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      const failure = attachFailure(file.name, error);
      if (!isExpectedUserStateError(error)) {
        captureException(error, { op: 'composer-attach', sessionId });
      }
      outcome.failed.push(failure);
    }
  }
  return outcome;
}

/**
 * Upload local files straight into the Library (Chat uploads), with no session
 * to mount them on. Schedules attach by durable URL, so a Library file is all
 * a run needs. Returns the picked-file shape the composer chips already render.
 */
export async function uploadFilesToLibrary(
  attachments: PendingAttachment[],
  context: AttachContext | null,
  signal: AbortSignal | undefined,
): Promise<{ files: ComposerLibraryFile[]; failed: AttachFailure[] }> {
  if (attachments.length === 0) return { files: [], failed: [] };
  if (!context?.uploadConfig.enabled) {
    return {
      files: [],
      failed: attachments.map(({ file }) => ({
        name: file.name,
        code: 'INTEGRATION_NOT_CONNECTED',
        message: CAPABILITY_OFF_MESSAGES.uploads,
      })),
    };
  }
  const files: ComposerLibraryFile[] = [];
  const failed: AttachFailure[] = [];
  for (const { file } of attachments) {
    const saved = libraryFileByBrowserFile.get(file);
    if (saved) {
      files.push(saved);
      continue;
    }
    try {
      signal?.throwIfAborted();
      const uploaded = await uploadBrowserFile({
        signal,
        file,
        workspaceId: context.workspaceId,
        folderPath: '/Chat uploads',
        uploadTag: context.uploadConfig.uploadTag,
        maxFileBytes: context.uploadConfig.maxFileBytes,
        shareToken: null,
        onProgress: null,
      });
      signal?.throwIfAborted();
      // eslint-disable-next-line no-restricted-syntax -- surfaces the server error body via readUploadError(response) in the thrown AppError, same as uploadAndAttach
      const response = await fetch('/api/files/sync-metadata', {
        signal,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          shareToken: null,
          storagePath: uploaded.storagePath,
          originalFileName: file.name,
          uploadSource: 'chat',
        }),
      });
      if (!response.ok) {
        const error = await readUploadError(response);
        throw new AppError(error.code, error.message, {
          op: 'schedule-attach-sync',
          fileName: file.name,
          status: response.status,
          expectedState: error.expectedState,
        });
      }
      const saved = readSavedLibraryFile(await response.json(), file.name);
      rememberPersistedAttachment(file, saved.id);
      libraryFileByBrowserFile.set(file, saved);
      files.push(saved);
    } catch (error) {
      if (signal?.aborted) throw error;
      failed.push(attachFailure(file.name, error));
      if (!isExpectedUserStateError(error)) {
        captureException(error, { op: 'schedule-attach' });
      }
    }
  }
  return { files, failed };
}

const libraryFileByBrowserFile = new WeakMap<File, ComposerLibraryFile>();

/** Resolves the chip state without throwing away a failed pick. */
export async function preparePendingAttachment(
  pending: PendingAttachment,
  context: AttachContext | null,
  sessionId: string | undefined,
  signal: AbortSignal | undefined,
): Promise<PendingAttachment> {
  const result = sessionId
    ? await uploadAndAttach([pending], context, sessionId, signal)
    : await uploadFilesToLibrary([pending], context, signal);
  const prepared = 'attached' in result ? result.attached.at(0) : result.files.at(0);
  if (prepared && result.failed.length === 0) {
    return reduceAttachmentUpload(pending, { type: 'ready', prepared });
  }
  return reduceAttachmentUpload(pending, {
    type: 'failed',
    error: result.failed[0]?.message ?? 'Couldn’t upload this file. Retry or remove it.',
  });
}
