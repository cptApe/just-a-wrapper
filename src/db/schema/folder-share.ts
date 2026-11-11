import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { file } from './file';
import { folder } from './folder';
import { workspace } from './workspace';

// Links target stable file/folder identities; two null targets mean the workspace root.
// Revocation is terminal. Expiry is derived from the request clock.
// Folder deletion cascades only when retention permanently removes its row.
export const folderShare = pgTable(
  'folder_share',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    folderId: uuid('folder_id').references(() => folder.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').references(() => file.id, { onDelete: 'cascade' }),
    mode: text('mode').$type<'view' | 'edit'>().notNull(),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('folder_share_folder_id_idx').on(t.folderId),
    index('folder_share_workspace_id_idx').on(t.workspaceId),
    index('folder_share_file_id_idx').on(t.fileId),
    check('folder_share_target_check', sql`${t.fileId} is null or ${t.folderId} is null`),
    check('folder_share_file_view_only_check', sql`${t.fileId} is null or ${t.mode} = 'view'`),
    check('folder_share_mode_check', sql`${t.mode} in ('view', 'edit')`),
  ],
);
