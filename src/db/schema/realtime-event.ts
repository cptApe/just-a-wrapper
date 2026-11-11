import { bigserial, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { StoredPublishedEvent } from '@/lib/workspace-event';
import { organization, user } from './auth';
export const realtimeEvent = pgTable(
  'realtime_event',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    audienceUserId: text('audience_user_id').references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<StoredPublishedEvent>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('realtime_event_workspace_cursor_idx').on(table.organizationId, table.id),
    index('realtime_event_created_idx').on(table.createdAt),
  ],
);
