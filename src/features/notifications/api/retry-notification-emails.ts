import 'server-only';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { member, notification, user } from '@/db/schema';
import { readContactDetails } from '@/lib/brand/contact';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { capabilities } from '@/lib/runtime-capabilities';
import { hasEventMapping, type NotificationEventName, requireEventDef } from '../lib/events';
import { emailReasonOf, notificationEmail } from '../lib/notification-email';
import {
  claimNotificationEmail,
  EMAIL_RETRY_WINDOW,
  expireNotificationEmails,
  finishNotificationEmail,
  skipNotificationEmail,
} from './notification-transitions';
import { emailEnabledUserIds } from './preference-gates';
import { sendTransactionalEmail } from './send-transactional-email';

type RetryRow = {
  notice: typeof notification.$inferSelect;
  email: string;
  accountStatus: string;
  isMember: boolean;
};

// Stored eligibility survives request loss; the person's state is read again before each send.
export async function retryNotificationEmails(): Promise<void> {
  // Expiry runs with email off too, so a disabled capability cannot leave rows pending.
  await expireNotificationEmails();
  if (capabilities.email.kind === 'off') return;
  const rows = await db
    .select({
      notice: notification,
      email: user.email,
      accountStatus: user.accountStatus,
      isMember: sql<boolean>`${member.id} is not null`,
    })
    .from(notification)
    .innerJoin(user, eq(user.id, notification.recipientUserId))
    .leftJoin(
      member,
      and(
        eq(member.userId, notification.recipientUserId),
        eq(member.organizationId, notification.organizationId),
      ),
    )
    .where(
      and(
        sql`${notification.createdAt} > now() - ${EMAIL_RETRY_WINDOW}`,
        or(
          eq(notification.emailStatus, 'pending'),
          and(
            eq(notification.emailStatus, 'sending'),
            sql`${notification.emailClaimedAt} < now() - interval '5 minutes'`,
          ),
        ),
      ),
    )
    .orderBy(asc(notification.createdAt))
    .limit(25);
  for (const row of rows) {
    try {
      await retryOne(row);
    } catch (error) {
      // Each durable occurrence retries independently on the next cron pass.
      captureException(error, {
        feature: 'notifications',
        op: 'email-sweep',
        notificationId: row.notice.id,
      });
    }
  }
}

async function retryOne({ notice, email, accountStatus, isMember }: RetryRow): Promise<void> {
  if (!hasEventMapping(notice.kind))
    throw new AppError('UNEXPECTED', 'Unknown notification kind', {
      notificationId: notice.id,
      kind: notice.kind,
    });
  const wanted = await stillWanted({
    kind: notice.kind,
    recipientUserId: notice.recipientUserId,
    payload: notice.payload,
    accountStatus,
    isMember,
  });
  if (!wanted) {
    await skipNotificationEmail(notice.id);
    return;
  }
  const claim = await claimNotificationEmail(notice.id);
  if (!claim) return;
  try {
    await sendTransactionalEmail({
      to: email,
      purpose: notice.kind,
      email: notificationEmail(notice.kind, notice.payload, await readContactDetails()),
      idempotencyKey: notice.id,
    });
    await finishNotificationEmail(notice.id, claim, 'sent');
  } catch (error) {
    await finishNotificationEmail(notice.id, claim, 'pending');
    throw error;
  }
}

// A schedule's own email choice stands; a preference email needs the switch still on.
async function stillWanted(input: {
  kind: NotificationEventName;
  recipientUserId: string;
  payload: unknown;
  accountStatus: string;
  isMember: boolean;
}): Promise<boolean> {
  if (input.accountStatus !== 'live' || !input.isMember) return false;
  if (emailReasonOf(input.payload) === 'schedule') return true;
  const enabled = await emailEnabledUserIds(
    [input.recipientUserId],
    requireEventDef(input.kind).preference,
  );
  return enabled.has(input.recipientUserId);
}
