import type { NotificationEventName, NotificationPayload } from '../lib/events';
import 'server-only';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { notification } from '@/db/schema';
import { notificationEmailMachine } from '../lib/notification-machine';

// Replays recover expired claims using the provider's stable notification idempotency key.
export async function claimNotificationEmail(id: string): Promise<Date | null> {
  await db
    .update(notification)
    .set({ emailStatus: 'pending', emailClaimedAt: null })
    .where(
      and(
        eq(notification.id, id),
        inArray(notification.emailStatus, notificationEmailMachine.sourcesOf('pending')),
        sql`${notification.emailClaimedAt} < now() - interval '5 minutes'`,
      ),
    );
  const at = new Date();
  const rows = await db
    .update(notification)
    .set({ emailStatus: 'sending', emailClaimedAt: at })
    .where(
      and(
        eq(notification.id, id),
        inArray(notification.emailStatus, notificationEmailMachine.sourcesOf('sending')),
      ),
    )
    .returning({ id: notification.id });
  return rows.length ? at : null;
}

export async function finishNotificationEmail(
  id: string,
  claim: Date,
  to: 'sent' | 'pending',
): Promise<boolean> {
  const rows = await db
    .update(notification)
    .set({ emailStatus: to, emailClaimedAt: null })
    .where(
      and(
        eq(notification.id, id),
        inArray(notification.emailStatus, notificationEmailMachine.sourcesOf(to)),
        eq(notification.emailClaimedAt, claim),
      ),
    )
    .returning({ id: notification.id });
  return rows.length > 0;
}

// A live claim belongs to the sender holding it; only a pending row or an abandoned claim may end.
function abandonedOrPending() {
  return or(
    eq(notification.emailStatus, 'pending'),
    sql`${notification.emailClaimedAt} < now() - interval '5 minutes'`,
  );
}

// A pending email the retry decided not to send: the person opted out, left or deleted their account.
export async function skipNotificationEmail(id: string): Promise<boolean> {
  const rows = await db
    .update(notification)
    .set({ emailStatus: 'skipped', emailClaimedAt: null })
    .where(
      and(
        eq(notification.id, id),
        inArray(notification.emailStatus, notificationEmailMachine.sourcesOf('skipped')),
        abandonedOrPending(),
      ),
    )
    .returning({ id: notification.id });
  return rows.length > 0;
}

// How long the sweep keeps retrying an email, on the database clock.
export const EMAIL_RETRY_WINDOW = sql.raw(`interval '1 day'`);

// Emails older than the retry window end here instead of waiting forever. A live claim
// is left to finish; an abandoned one expires with the pending rows.
export async function expireNotificationEmails(): Promise<number> {
  const rows = await db
    .update(notification)
    .set({ emailStatus: 'expired', emailClaimedAt: null })
    .where(
      and(
        sql`${notification.createdAt} <= now() - ${EMAIL_RETRY_WINDOW}`,
        inArray(notification.emailStatus, notificationEmailMachine.sourcesOf('expired')),
        abandonedOrPending(),
      ),
    )
    .returning({ id: notification.id });
  return rows.length;
}

export async function transitionNotificationsRead(
  organizationId: string,
  userId: string,
  ids: string[] | null,
): Promise<boolean> {
  const rows = await db
    .update(notification)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notification.organizationId, organizationId),
        eq(notification.recipientUserId, userId),
        isNull(notification.readAt),
        ids ? inArray(notification.id, ids) : undefined,
      ),
    )
    .returning({ id: notification.id });
  return rows.length > 0;
}

export async function storeNotificationOccurrence(
  eventName: NotificationEventName,
  payload: NotificationPayload,
  recipientUserId: string,
  content: Record<string, unknown>,
  eligible: boolean,
) {
  const inserted = (
    await db
      .insert(notification)
      .values({
        organizationId: payload.organizationId,
        recipientUserId: recipientUserId,
        kind: eventName,
        emailStatus: eligible ? 'pending' : 'skipped',
        payload: content,
        inApp: payload.channels?.inApp !== false,
        idempotencyKey: payload.idempotencyKey,
      })
      .onConflictDoNothing()
      .returning()
  ).at(0);
  const stored =
    inserted ??
    (payload.idempotencyKey
      ? await db.query.notification.findFirst({
          where: and(
            eq(notification.organizationId, payload.organizationId),
            eq(notification.recipientUserId, recipientUserId),
            eq(notification.idempotencyKey, payload.idempotencyKey),
          ),
        })
      : undefined);
  return { stored, inserted: Boolean(inserted) };
}
