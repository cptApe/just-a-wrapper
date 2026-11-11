import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { organization, user } from './auth';
export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    recipientUserId: text('recipient_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    inApp: boolean('in_app').notNull().default(true),
    idempotencyKey: text('idempotency_key'),
    emailStatus: text('email_status')
      .$type<'pending' | 'sending' | 'sent' | 'skipped' | 'expired'>()
      .notNull()
      .default('skipped'),
    emailClaimedAt: timestamp('email_claimed_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      'notification_kind_check',
      sql`${table.kind} in ('task.completed', 'task.failed', 'task.needs_input', 'topup.granted', 'credits.low', 'credits.paused', 'payment.failed', 'plan.updated', 'integration.broken', 'team.member_joined', 'team.added_to_workspace', 'share.received')`,
    ),
    check(
      'notification_email_status_check',
      sql`${table.emailStatus} in ('pending', 'sending', 'sent', 'skipped', 'expired')`,
    ),
    check(
      'notification_email_claim_check',
      sql`(${table.emailStatus} = 'sending') = (${table.emailClaimedAt} is not null)`,
    ),
    index('notification_email_retry_idx')
      .on(table.createdAt)
      .where(sql`${table.emailStatus} in ('pending', 'sending')`),
    index('notification_recipient_created_idx').on(
      table.organizationId,
      table.recipientUserId,
      table.createdAt,
      table.id,
    ),
    uniqueIndex('notification_occurrence_idx').on(
      table.organizationId,
      table.recipientUserId,
      table.idempotencyKey,
    ),
  ],
);
