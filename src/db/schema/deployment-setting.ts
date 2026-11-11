import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';

// Deployment settings an admin changes in the app (src/lib/deployment-settings). The table is
// append-only: every change is a new row, so the newest row per key is the value and the rows
// before it are the audit of who changed what and when. A null value clears the stored setting,
// and the matching environment variable applies again.
export const deploymentSetting = pgTable(
  'deployment_setting',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    value: jsonb('value'),
    // Null when the admin console runs open on a local checkout with nobody signed in.
    changedByUserId: text('changed_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('deployment_setting_key_changed_at_idx').on(t.key, t.changedAt.desc(), t.id.desc()),
    check('deployment_setting_key_check', sql`char_length(${t.key}) between 1 and 100`),
  ],
);
