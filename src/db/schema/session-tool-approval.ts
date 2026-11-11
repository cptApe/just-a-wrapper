import { sql } from 'drizzle-orm';
import { check, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { session } from './session';

// A task-local approval remembered for the lifetime of one Agent session.
// Rows are intentionally narrower than the member's global tool_permission:
// they say only that this exact upstream tool may skip future ask-gates in this
// session. The session FK owns cleanup, so an archived/deleted task cannot
// leave approval state behind.
export const sessionToolApproval = pgTable(
  'session_tool_approval',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.toolName] }),
    check('session_tool_approval_tool_name_check', sql`btrim(${t.toolName}) <> ''`),
  ],
);
