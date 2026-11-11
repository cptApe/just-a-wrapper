import { and, eq, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { notification } from '@/db/schema/notification';
import { AppError } from '@/lib/errors';
import type { PreferenceCategory } from '../types';
import { NOTIFICATION_EVENTS } from './events';

const cursorSchema = z.uuid();
export function notificationFeedQuery(input: {
  organizationId: string;
  userId: string;
  muted: PreferenceCategory[];
  filter: 'all' | 'unread';
  after: string | null;
}) {
  const hidden = Object.entries(NOTIFICATION_EVENTS)
    .filter(([, event]) => input.muted.includes(event.preference))
    .map(([kind]) => kind);
  const predicates = [
    eq(notification.organizationId, input.organizationId),
    eq(notification.recipientUserId, input.userId),
    eq(notification.inApp, true),
  ];
  if (hidden.length) predicates.push(notInArray(notification.kind, hidden));
  if (input.filter === 'unread') predicates.push(isNull(notification.readAt));
  if (input.after) {
    const parsed = cursorSchema.safeParse(input.after);
    if (!parsed.success) throw new AppError('INVALID_BODY', 'Invalid notification cursor', {});
    // Read the stored timestamp to preserve Postgres microseconds across a JavaScript cursor.
    const timestamp = sql`(select created_at from notification where id = ${parsed.data} and organization_id = ${input.organizationId} and recipient_user_id = ${input.userId})`;
    return and(
      ...predicates,
      or(
        lt(notification.createdAt, timestamp),
        and(eq(notification.createdAt, timestamp), lt(notification.id, parsed.data)),
      ),
    );
  }
  return and(...predicates);
}
