import { sql } from 'drizzle-orm';
import { check, foreignKey, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { workspaceMember } from './workspace-member';

// A member's request for an app the Tools catalog does not carry ("Request an app").
// Rows are read out-of-band: no notification fanout and no status field. Scoped to
// the member like tool_permission: the composite FK mirrors workspace_member's PK
// and cascades with it.
export const toolRequest = pgTable(
  'tool_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    userId: text('user_id').notNull(),
    message: text('message').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'tool_request_member_fk',
      columns: [t.organizationId, t.userId],
      foreignColumns: [workspaceMember.organizationId, workspaceMember.userId],
    }).onDelete('cascade'),
    check('tool_request_message_check', sql`${t.message} <> ''`),
  ],
);
