'use server';
import { and, eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { z } from 'zod';
import { db } from '@/db';
import { messageFeedback } from '@/db/schema';
import { authorizeSessionAccess } from '@/features/sessions';
import { runAction } from '@/lib/action-state';
import { CHAT_ACTION } from '../constants';

export async function getMessageFeedback(sessionId: string) {
  return runAction({ ...CHAT_ACTION, route: 'chat/feedback/get', op: 'get' }, async () => {
    const parsed = z.object({ sessionId: z.string().uuid() }).parse({ sessionId });
    const { workspaceId, userId, sessionRowId } = await authorizeSessionAccess({
      sessionId: parsed.sessionId,
      headers: await headers(),
    });
    const rows = await db
      .select({
        eventId: messageFeedback.anthropicEventId,
        rating: messageFeedback.rating,
        comment: messageFeedback.comment,
      })
      .from(messageFeedback)
      .where(
        and(
          eq(messageFeedback.kind, 'message'),
          eq(messageFeedback.workspaceId, workspaceId),
          eq(messageFeedback.userId, userId),
          eq(messageFeedback.sessionId, sessionRowId),
        ),
      );
    return Object.fromEntries(
      rows.flatMap((row) =>
        row.eventId && row.rating
          ? [[row.eventId, { rating: row.rating, comment: row.comment ?? '' }]]
          : [],
      ),
    );
  });
}
