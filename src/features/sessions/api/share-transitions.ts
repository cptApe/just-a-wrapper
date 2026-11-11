import 'server-only';
import { and, eq, inArray, isNull, lte, type SQL } from 'drizzle-orm';
import { db } from '@/db';
import { session, sessionShare } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { generateShareToken } from '@/lib/share-token';
import { teamShareMachine } from '../lib/share-machine';

type ShareChange = 'public' | 'team' | 'private';

export async function revokeLiveShares(
  writer: Pick<typeof db, 'update'>,
  predicate: SQL | undefined,
  options: { expiredOnly: boolean },
) {
  return writer
    .update(sessionShare)
    .set({ revokedAt: new Date() })
    .where(
      and(
        predicate,
        isNull(sessionShare.revokedAt),
        options.expiredOnly ? lte(sessionShare.expiresAt, new Date()) : undefined,
      ),
    )
    .returning({ id: sessionShare.id });
}

export async function changeSessionSharing(input: {
  sessionId: string;
  workspaceId: string;
  userId: string;
  change: ShareChange;
}) {
  return db.transaction(async (transaction) => {
    const row = (
      await transaction
        .select()
        .from(session)
        .where(
          and(
            eq(session.id, input.sessionId),
            eq(session.workspaceId, input.workspaceId),
            eq(session.createdByUserId, input.userId),
            isNull(session.hiddenAt),
          ),
        )
        .for('update')
    ).at(0);
    if (!row)
      throw new AppError('SESSION_NOT_FOUND', 'Session not found', { sessionId: input.sessionId });
    let created = false;
    if (input.change === 'private' || input.change === 'team')
      await revokeLiveShares(transaction, eq(sessionShare.sessionId, row.id), {
        expiredOnly: false,
      });
    if (input.change === 'public') {
      await revokeLiveShares(transaction, eq(sessionShare.sessionId, row.id), {
        expiredOnly: true,
      });
      const inserted = await transaction
        .insert(sessionShare)
        .values({
          workspaceId: input.workspaceId,
          sessionId: row.id,
          createdByUserId: input.userId,
          token: generateShareToken(),
        })
        .onConflictDoNothing({
          target: sessionShare.sessionId,
          where: isNull(sessionShare.revokedAt),
        })
        .returning({ id: sessionShare.id });
      created = inserted.length > 0;
    }
    const visibility =
      input.change === 'team'
        ? 'workspace'
        : input.change === 'private'
          ? 'private'
          : row.visibility;
    const moved =
      visibility === row.visibility
        ? []
        : await transaction
            .update(session)
            .set({ visibility })
            .where(
              and(
                eq(session.id, row.id),
                inArray(session.visibility, teamShareMachine.sourcesOf(visibility)),
              ),
            )
            .returning({ id: session.id });
    const share =
      (
        await transaction
          .select()
          .from(sessionShare)
          .where(and(eq(sessionShare.sessionId, row.id), isNull(sessionShare.revokedAt)))
      ).at(0) ?? null;
    return { created, visibility, changed: moved.length > 0, share, title: row.title };
  });
}
