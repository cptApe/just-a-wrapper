import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { file } from './file';
import { session } from './session';
import { workspace } from './workspace';

// An agent-created file output (Stage: Artifacts). The bytes live in the
// Anthropic Files API, scoped to the session that produced them (the agent
// writes to /mnt/session/outputs/ and the platform captures it); this row is
// our metadata mirror, discovered by the artifact sweep (relay settle +
// Anthropic webhook). The Files API documents no TTL — files persist until
// deleted — so this mirror, not re-listing, is what the chat cards and the
// /knowledge/artifacts library render from.
//
// `anthropic_file_id` is the idempotency key: the sweep upserts on it, so
// replayed relays, double-attached tabs, and webhook redeliveries are free.
// Saves to the Library live in `artifact_save`, one row per person.
// `size_bytes` is bigint: the Files API allows files up to 500 MB, and the
// int4 ceiling (~2.1 GB) is too close to a real artifact size to bank on.
export const artifact = pgTable(
  'artifact',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id),
    anthropicFileId: text('anthropic_file_id').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    // Whether the Files API will serve the bytes (only agent/skill-created
    // files are downloadable; uploads are not). Gates preview + download UI.
    downloadable: boolean('downloadable').notNull().default(false),
    // The Files API's own created_at — orders artifacts by actual creation,
    // not by when our sweep happened to discover them.
    fileCreatedAt: timestamp('file_created_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The sweep's idempotency target and the content route's lookup key.
    uniqueIndex('artifact_anthropic_file_id_uidx').on(t.anthropicFileId),
    // Library lists a workspace's artifacts; chat lists a session's.
    index('artifact_workspace_id_idx').on(t.workspaceId),
    index('artifact_session_id_idx').on(t.sessionId),
    check('artifact_size_bytes_check', sql`${t.sizeBytes} >= 0`),
  ],
);

// One person's Library copy of an artifact. Library copies are private to the
// person who saved them, so "saved" is per person, never per artifact. Trashing
// the copy deletes this row, so that person can save the artifact again.
export const artifactSave = pgTable(
  'artifact_save',
  {
    artifactId: uuid('artifact_id')
      .notNull()
      .references(() => artifact.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id')
      .notNull()
      .references(() => file.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.artifactId, t.userId] }),
    // A Library file is the copy of at most one artifact; trash unlinks by it.
    uniqueIndex('artifact_save_file_id_uidx').on(t.fileId),
  ],
);
