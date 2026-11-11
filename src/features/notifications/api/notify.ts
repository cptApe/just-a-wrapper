import 'server-only';
import { publishMemberEvent } from '@/features/realtime/server';
import { readContactDetails } from '@/lib/brand/contact';
import { captureException } from '@/lib/observability';
import { capabilities } from '@/lib/runtime-capabilities';
import {
  isAway,
  linkForEvent,
  type NotificationEventName,
  type NotificationPayload,
  requireEventDef,
} from '../lib/events';
import { type EmailReason, notificationEmail } from '../lib/notification-email';
import { recipientsForOrg } from '../lib/recipients';
import {
  claimNotificationEmail,
  finishNotificationEmail,
  storeNotificationOccurrence,
} from './notification-transitions';
import { emailEnabledUserIds } from './preference-gates';
import { sendTransactionalEmail } from './send-transactional-email';
export async function notify(
  eventName: NotificationEventName,
  payload: NotificationPayload,
): Promise<void> {
  const definition = requireEventDef(eventName);
  const members = await recipientsForOrg(payload.organizationId);
  // Intersect requested recipients with current membership so callers cannot notify another tenant.
  const requested = payload.recipientUserIds;
  const recipients = requested
    ? members.filter((member) => requested.includes(member.userId))
    : members;
  // Email preferences gate delivery; feed preferences gate reads so unmuting restores history.
  // A schedule set to email sends whether or not the person is away; preference email waits for away.
  const emailMode = payload.channels?.email ?? 'preference';
  const allowed =
    emailMode === 'preference'
      ? await emailEnabledUserIds(
          recipients.map((member) => member.userId),
          definition.preference,
        )
      : new Set<string>();
  const emailReason: EmailReason = emailMode === 'force' ? 'schedule' : 'away';
  const content = {
    ...payload.data,
    link: linkForEvent(eventName, payload.data),
    category: definition.category,
    emailReason,
  };
  const deliveries = await Promise.allSettled(
    recipients.map(async (recipient) => {
      const eligible =
        Boolean(definition.email) &&
        capabilities.email.kind !== 'off' &&
        (emailMode === 'force' ||
          (emailMode === 'preference' &&
            allowed.has(recipient.userId) &&
            isAway(recipient.lastActiveAt, new Date())));
      const record = await storeNotificationOccurrence(
        eventName,
        payload,
        recipient.userId,
        content,
        eligible,
      );
      const stored = record.stored;
      if (!stored) return;
      if (record.inserted)
        await publishMemberEvent(payload.organizationId, recipient.userId, {
          type: 'notification',
          notificationId: stored.id,
        });
      const claim = await claimNotificationEmail(stored.id);
      if (claim) {
        try {
          await sendTransactionalEmail({
            to: recipient.email,
            purpose: eventName,
            email: notificationEmail(eventName, content, await readContactDetails()),
            idempotencyKey: stored.id,
          });
          await finishNotificationEmail(stored.id, claim, 'sent');
        } catch (error) {
          await finishNotificationEmail(stored.id, claim, 'pending');
          throw error;
        }
      }
    }),
  );
  // Durable email claims are retried by the sweep; delivery must not roll back provisioning.
  for (const delivery of deliveries) {
    if (delivery.status === 'rejected')
      captureException(delivery.reason, { feature: 'notifications', op: 'notify', eventName });
  }
}
