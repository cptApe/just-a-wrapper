import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { session } from './session';
import { workspace } from './workspace';

// File creators cannot be cascade-deleted: stored files are audit and billing records.
// Account removal must use the explicit offboarding path.
export const file = pgTable(
  'file',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    source: text('source').$type<'user_upload' | 'agent_generated' | 'session_output'>().notNull(),
    sessionId: uuid('session_id').references(() => session.id),
    // Immutable ws/{workspaceId}/… key; rename and move never rewrite it.
    storagePath: text('storage_path').notNull().unique(),
    // Null when the image format is unsupported or its preview cannot be decoded.
    thumbnailPath: text('thumbnail_path'),
    // Keep the display folder separate so rename and move never copy stored bytes.
    // Begins with /, no trailing slash; root is /. Feeds grid, tree and search.
    folderPath: text('folder_path').notNull().default('/'),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('file_thumbnail_path_idx').on(t.thumbnailPath),
    index('file_workspace_id_idx').on(t.workspaceId),
    // Path-scoped listing for the grid view and edit-share folder reads.
    index('file_workspace_folder_path_idx').on(t.workspaceId, t.folderPath),
    check(
      'file_source_check',
      sql`${t.source} in ('user_upload', 'agent_generated', 'session_output')`,
    ),
  ],
);
