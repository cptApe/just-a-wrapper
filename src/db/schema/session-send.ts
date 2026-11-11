import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { session } from './session';

// A durable client request identity prevents retries from posting a second turn.
export const sessionSend = pgTable(
  'session_send',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    contentHash: text('content_hash').notNull(),
    status: text('status').$type<'sending' | 'delivered' | 'error' | 'unconfirmed'>().notNull(),
    eventId: text('event_id'),
    processedAt: text('processed_at'),
    // The open attempt: the sender's lease while 'sending', the attempt to confirm while 'unconfirmed'.
    attemptToken: uuid('attempt_token'),
    // Database time after which recovery may act: the lease end while 'sending', the end of the
    // provider-log confirmation window while 'unconfirmed'.
    recoverAfter: timestamp('recover_after', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('session_send_session_id_idx').on(table.sessionId),
    index('session_send_recover_after_idx')
      .on(table.recoverAfter)
      .where(sql`${table.recoverAfter} is not null`),
    check(
      'session_send_status_check',
      sql`${table.status} in ('sending', 'delivered', 'error', 'unconfirmed')`,
    ),
    check(
      'session_send_echo_check',
      sql`(${table.status} = 'delivered') = (${table.eventId} is not null)`,
    ),
    check(
      'session_send_attempt_check',
      sql`(${table.status} in ('sending', 'unconfirmed')) = (${table.attemptToken} is not null and ${table.recoverAfter} is not null)`,
    ),
  ],
);
