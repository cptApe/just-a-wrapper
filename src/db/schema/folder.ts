import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { workspace } from './workspace';

// Empty folders need durable rows; bytes alone cannot describe the folder tree.
// Paths begin with /, have no trailing slash, and never store root as a row.
// Creator deletion is restricted so shared folders survive until explicit offboarding.
export const folder = pgTable(
  'folder',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    path: text('path').notNull(),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    // One live folder per (workspace, path). Partial on the soft-delete tombstone
    // so a deleted path can be re-created later without a unique collision.
    uniqueIndex('folder_workspace_path_uidx')
      .on(t.workspaceId, t.path)
      .where(sql`${t.deletedAt} is null`),
  ],
);
