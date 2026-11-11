import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { session } from './session';
import { workspace } from './workspace';

// A session is unread when its latest event is newer than this viewer's read cursor.
// Viewer state is disposable; deleting a user removes their cursors.
export const sessionReadState = pgTable(
  'session_read_state',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.userId] }),
    index('session_read_state_workspace_id_idx').on(t.workspaceId),
  ],
);
