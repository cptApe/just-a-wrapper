import 'server-only';
import { APIError } from '@anthropic-ai/sdk';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { file, session, sessionFileMount } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { AppError } from '@/lib/errors';
import { assertBeforeDeadline } from '@/lib/sweep-deadline';

export async function recordSessionFileMount(input: typeof sessionFileMount.$inferSelect) {
  await db.transaction(async (tx) => {
    const owner = (
      await tx
        .select({ id: session.id })
        .from(session)
        .where(
          and(
            eq(session.id, input.sessionId),
            eq(session.workspaceId, input.workspaceId),
            isNull(session.hiddenAt),
          ),
        )
        .for('update')
    ).at(0);
    if (!owner)
      throw new AppError('SESSION_NOT_FOUND', 'Cannot retain a mount for an unavailable session', {
        sessionId: input.sessionId,
      });
    if (input.fileId) {
      const source = (
        await tx
          .select({ id: file.id })
          .from(file)
          .where(
            and(
              eq(file.id, input.fileId),
              eq(file.workspaceId, input.workspaceId),
              isNull(file.deletedAt),
            ),
          )
          .for('update')
      ).at(0);
      if (!source)
        throw new AppError('ARTIFACT_NOT_FOUND', 'Cannot mount a missing or trashed source file', {
          fileId: input.fileId,
        });
    }
    await tx.insert(sessionFileMount).values(input);
  });
}

export async function deleteSessionFileMounts(predicate: SQL, deadline: number) {
  const mounts = await db.select().from(sessionFileMount).where(predicate);
  if (mounts.length === 0) return;
  const client = requireAnthropicClient();
  for (const mount of mounts) {
    assertBeforeDeadline(deadline);
    try {
      await client.beta.files.delete(
        mount.anthropicFileId,
        { betas: ['files-api-2025-04-14'] },
        { timeout: 10_000, maxRetries: 0 },
      );
    } catch (cause) {
      if (!(cause instanceof APIError && cause.status === 404)) {
        throw new AppError(
          'EXTERNAL_API_FAILED',
          'Could not delete retained file upload',
          { anthropicFileId: mount.anthropicFileId },
          { cause },
        );
      }
    }
    await db
      .delete(sessionFileMount)
      .where(eq(sessionFileMount.anthropicFileId, mount.anthropicFileId));
  }
}
