import { transitionNotificationsRead } from './notification-transitions';
import 'server-only';
import { and, count, desc, eq, gt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/db';
import { notification, workspaceMember } from '@/db/schema';
import { publishMemberEvent } from '@/features/realtime/server';
import { notificationFeedQuery } from '../lib/feed-query';
import type { FeedItem, NotificationReadInput } from '../lib/feed-schema';
import { mutedInAppCategories } from './preference-gates';

const FEED_PAGE_SIZE = 20;
type Member = { organizationId: string; userId: string };
export async function readNotificationFeed(
  identity: Member,
  input: { filter: 'all' | 'unread'; after: string | null },
) {
  const muted = await mutedInAppCategories(identity.userId);
  const base = { ...identity, muted };
  // Filter muted categories before both pagination and counts; loaded pages alone cannot count them.
  const [rows, totals, unread, unseen] = await Promise.all([
    db
      .select()
      .from(notification)
      .where(notificationFeedQuery({ ...base, ...input }))
      .orderBy(desc(notification.createdAt), desc(notification.id))
      .limit(FEED_PAGE_SIZE + 1),
    db
      .select({ count: count() })
      .from(notification)
      .where(notificationFeedQuery({ ...base, filter: 'all', after: null })),
    db
      .select({ count: count() })
      .from(notification)
      .where(notificationFeedQuery({ ...base, filter: 'unread', after: null })),
    db
      .select({ count: count() })
      .from(notification)
      .where(
        and(
          notificationFeedQuery({ ...base, filter: 'unread', after: null }),
          gt(
            notification.createdAt,
            sql`coalesce((${db
              .select({ seenAt: workspaceMember.notificationsSeenAt })
              .from(workspaceMember)
              .where(
                and(
                  eq(workspaceMember.organizationId, identity.organizationId),
                  eq(workspaceMember.userId, identity.userId),
                ),
              )}), '-infinity'::timestamptz)`,
          ),
        ),
      ),
  ]);
  const page = rows.slice(0, FEED_PAGE_SIZE);
  const last = page.at(-1);
  const unreadCount = unread[0]?.count ?? 0;
  return {
    items: page.map(
      (row): FeedItem => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
        kind: row.kind,
        data: z.record(z.string(), z.unknown()).parse(row.payload),
      }),
    ),
    after: rows.length > FEED_PAGE_SIZE && last ? last.id : null,
    metadata: {
      totalCount: totals[0]?.count ?? 0,
      unreadCount,
      unseenCount: unseen[0]?.count ?? 0,
    },
  };
}
export async function markNotificationsRead(identity: Member, input: NotificationReadInput) {
  const now = new Date();
  await db
    .update(workspaceMember)
    .set({
      lastActiveAt: now,
      ...(input.scope === 'seen'
        ? { notificationsSeenAt: sql`greatest(${workspaceMember.notificationsSeenAt}, ${now})` }
        : {}),
    })
    .where(
      and(
        eq(workspaceMember.organizationId, identity.organizationId),
        eq(workspaceMember.userId, identity.userId),
      ),
    );
  if (input.scope !== 'seen')
    await transitionNotificationsRead(
      identity.organizationId,
      identity.userId,
      input.scope === 'selected' ? input.ids : null,
    );
  await publishMemberEvent(identity.organizationId, identity.userId, {
    type: 'notifications_read',
  });
}
