import { sql } from 'drizzle-orm';
import { boolean, check, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';

// Per-user notification preferences: the switches on Settings → Notifications.
// One row per (user, category). `in_app` and `email` are the two channels; a
// category's email switch exists only when one of its events sends email.
//
// Notifications sit under the Personal group and follow the USER, so the row is
// keyed to `user.id` (text) ON DELETE cascade — not the workspace. An absent row
// means category defaults (task email off); the read layer merges defaults over stored
// rows, so there is no seeding migration.
export const notificationPreference = pgTable(
  'notification_preference',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    category: text('category')
      .$type<'account_billing' | 'connections' | 'team_sharing' | 'task_alerts'>()
      .notNull(),
    inApp: boolean('in_app').notNull().default(true),
    email: boolean('email').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('notification_preference_user_category_unique').on(t.userId, t.category),
    check(
      'notification_preference_category_check',
      sql`${t.category} in ('account_billing', 'connections', 'team_sharing', 'task_alerts')`,
    ),
  ],
);
