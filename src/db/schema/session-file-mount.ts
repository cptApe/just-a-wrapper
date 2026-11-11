import { index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { file } from './file';
import { session } from './session';
import { workspace } from './workspace';

// Restrict deletion until provider cleanup succeeds, so a retry never loses the file id.
export const sessionFileMount = pgTable(
  'session_file_mount',
  {
    anthropicFileId: text('anthropic_file_id').primaryKey(),
    fileId: uuid('file_id').references(() => file.id),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
  },
  (table) => [
    index('session_file_mount_file_idx').on(table.fileId),
    index('session_file_mount_workspace_idx').on(table.workspaceId),
  ],
);
