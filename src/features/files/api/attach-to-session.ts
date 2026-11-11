import 'server-only';
import { requireAnthropicClient } from '@/features/agents';
import { IntegrationError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { uploadFileToAnthropic } from '../lib/anthropic-upload';
import { MAX_SESSION_MOUNT_BYTES } from '../lib/limits';
import { readBlobBytes } from './blob-storage';
import { recordSessionFileMount } from './session-file-mounts';

const ATTACH_BETAS: Array<'files-api-2025-04-14' | 'managed-agents-2026-04-01'> = [
  'files-api-2025-04-14',
  'managed-agents-2026-04-01',
];

export type MountedSessionFile = {
  anthropicFileId: string;
  mountedPath: string;
};

export type AttachInput = {
  sessionId: string;
  sessionRowId: string;
  fileId: string;
  filename: string;
  mountFilename: string;
  mimeType: string;
  workspaceId: string;
  storagePath: string;
  sourceSizeBytes: number;
};

/** Upload and mount one file without opening an agent turn. */
export async function attachFileToSession(input: AttachInput): Promise<MountedSessionFile> {
  if (input.sourceSizeBytes > MAX_SESSION_MOUNT_BYTES) {
    throw new IntegrationError('VALIDATION_FAILED', 'The attached file exceeds the 25 MB limit.', {
      filename: input.filename,
      expectedState: true,
    });
  }
  const client = requireAnthropicClient();

  const uploaded = await uploadFileToAnthropic(client, {
    bytes: await readBlobBytes(input.storagePath, input.sourceSizeBytes),
    filename: `agentcore_${input.sessionRowId}_${input.fileId}_${input.filename}`,
    mimeType: input.mimeType,
    sourceSizeBytes: input.sourceSizeBytes,
  });
  try {
    await recordSessionFileMount({
      anthropicFileId: uploaded.fileId,
      fileId: input.fileId,
      sessionId: input.sessionRowId,
      workspaceId: input.workspaceId,
    });
    await client.beta.sessions.resources.add(input.sessionId, {
      type: 'file',
      file_id: uploaded.fileId,
      mount_path: `/${input.mountFilename}`,
      betas: ATTACH_BETAS,
    });
  } catch (cause) {
    try {
      await client.beta.files.delete(uploaded.fileId, { betas: ATTACH_BETAS });
    } catch (cleanupCause) {
      // A failed compensation must not hide the mount error that the caller can retry.
      captureException(cleanupCause, {
        operation: 'failed-mount-cleanup',
        fileId: uploaded.fileId,
      });
    }
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not mount uploaded file.',
      { sessionId: input.sessionId, filename: input.filename },
      { cause },
    );
  }

  return {
    anthropicFileId: uploaded.fileId,
    mountedPath: `/mnt/session/uploads/${input.mountFilename}`,
  };
}
