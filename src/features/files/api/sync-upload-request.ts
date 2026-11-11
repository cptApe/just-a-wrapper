import 'server-only';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { file } from '@/db/schema';
import { resolveCaller } from '@/lib/caller';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { requireOwnedUpload } from '../lib/upload-policy';
import { cleanupBlob } from './blob-storage';
import { attachExistingUploadedFile, syncSharedUpload, syncUploadedFile } from './sync-metadata';
import { resolveUploadAccess } from './upload-access';

export const syncUploadBody = z.union([
  z.object({
    existingFileId: z.uuid(),
    clientSizeBytes: z.number().int().positive(),
    sessionId: z.string().min(1),
  }),
  z.object({
    storagePath: z.string().min(1),
    originalFileName: z.string().min(1),
    uploadSource: z.enum(['chat', 'library']),
    shareToken: z.string().min(1).nullable(),
  }),
]);

export async function syncUploadRequest(request: Request, body: z.infer<typeof syncUploadBody>) {
  if ('existingFileId' in body) {
    const actor = await resolveCaller(request.headers);
    return {
      attachment: await attachExistingUploadedFile({
        ...actor,
        fileId: body.existingFileId,
        clientSizeBytes: body.clientSizeBytes,
        sessionId: body.sessionId,
      }),
    };
  }
  const actor = await resolveUploadAccess(body.shareToken, request.headers);
  const { folderPath } = requireOwnedUpload(
    actor.workspaceId,
    actor.principal,
    body.storagePath,
    actor.folderPath,
  );
  const existing = (
    await db
      .select({ id: file.id })
      .from(file)
      .where(eq(file.storagePath, body.storagePath))
      .limit(1)
  ).at(0);
  if (existing)
    throw new AppError('VALIDATION_FAILED', 'This upload is already saved.', {
      fileId: existing.id,
    });
  try {
    if (actor.kind === 'share')
      return { file: await syncSharedUpload({ actor, folderPath, upload: body }) };
    return await syncUploadedFile({
      actor,
      folderPath,
      upload: body,
      uploadSource: body.uploadSource,
    });
  } catch (cause) {
    // Remove unclaimed bytes; a committed file must survive a concurrent sync.
    try {
      const saved = (
        await db
          .select({ id: file.id })
          .from(file)
          .where(eq(file.storagePath, body.storagePath))
          .limit(1)
      ).at(0);
      if (!saved) await cleanupBlob(body.storagePath);
    } catch (cleanupCause) {
      captureException(cleanupCause, { operation: 'upload-cleanup', pathname: body.storagePath });
    }
    throw cause;
  }
}
