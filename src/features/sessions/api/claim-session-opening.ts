import 'server-only';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { AppError } from '@/lib/errors';
import { parseSessionId } from './session-access';
import { transitionSession } from './session-transitions';

/** Reserve the sole opening slot before sending to the provider. */
export async function claimSessionOpening(
  input: { sessionId: string; workspaceId: string; createdByUserId: string },
  executor: Pick<typeof db, 'update'> = db,
): Promise<number> {
  const where = and(
    eq(sessionTable.id, parseSessionId(input.sessionId)),
    eq(sessionTable.workspaceId, input.workspaceId),
    eq(sessionTable.createdByUserId, input.createdByUserId),
    isNull(sessionTable.hiddenAt),
  );
  const claimed = (
    await transitionSession({
      executor,
      to: 'opening',
      expected: null,
      pause: null,
      activity: null,
      where,
    })
  ).at(0);
  if (!claimed)
    throw new AppError('INVALID_BODY', 'This task already has an opening message.', {
      sessionId: input.sessionId,
      expectedState: true,
    });
  return claimed.stateVersion;
}
