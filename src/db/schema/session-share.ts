import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { session } from './session';
import { workspace } from './workspace';

// A public share link for a chat thread (task sharing). Mirrors
// `folder_share` minus `mode`: a task share is view-only (no live
// collaboration), so there is no access-mode column.
//
// "Public" for a thread means a live row exists here; "Only me" means none does.
// This is deliberately NOT the session `visibility` column — that is the
// private/workspace concept for the owner's own listing, orthogonal to a public
// link.
//
// `session_id` references OUR local session row (uuid PK), never
// `anthropic_session_id` — the public resolver reads the local row and only then
// reaches the Managed Sessions API with the owner's server-side credentials.
//
// `token` is a url-safe random string in the public link (`/share/<token>`); it is
// UNIQUE so resolution is a single indexed lookup. A link is live only when
// `revoked_at is null` AND (`expires_at is null` OR `expires_at > now()`) — that
// predicate is enforced in code (lib/share-token.ts) and unit-tested, not in the
// DB, because "now" is request-time. `created_by_user_id` FKs ON DELETE restrict
// to match the session/file/folder audit posture: a share is audit-relevant.
export const sessionShare = pgTable(
  'session_share',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('session_share_one_live_per_session')
      .on(t.sessionId)
      .where(sql`${t.revokedAt} is null`),
    index('session_share_workspace_id_idx').on(t.workspaceId),
    index('session_share_session_id_idx').on(t.sessionId),
  ],
);
