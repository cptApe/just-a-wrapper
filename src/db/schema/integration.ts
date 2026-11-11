import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { workspace } from './workspace';

// Per-member third-party connection (Composio). One personal connection per
// (workspace, user, toolkit). `user_id` FKs to Better Auth `user` ON DELETE
// cascade — a personal connection dies with its user (Composio-side cleanup is
// handled separately at offboarding). Workspace-shared accounts live in
// `shared_integration`.
export const integration = pgTable(
  'integration',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    toolkit: text('toolkit').notNull(),
    status: text('status')
      .$type<'connected' | 'disconnecting' | 'disconnected'>()
      .notNull()
      .default('disconnected'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'integration_status_check',
      sql`${t.status} in ('connected', 'disconnecting', 'disconnected')`,
    ),
    unique('integration_workspace_user_toolkit_uq').on(t.workspaceId, t.userId, t.toolkit),
    index('integration_workspace_id_idx').on(t.workspaceId),
  ],
);

// One workspace-shared account per (workspace, toolkit). The Composio account is
// owned by the workspace identity and pinned into member sessions; the account id
// never leaves the server. The sharer's departure revokes the share because the
// credential is theirs, so `shared_by_user_id` only goes null on a row already removing.
export const sharedIntegration = pgTable(
  'shared_integration',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id, { onDelete: 'cascade' }),
    toolkit: text('toolkit').notNull(),
    status: text('status').$type<'pending' | 'active' | 'removing'>().notNull().default('pending'),
    connectedAccountId: text('connected_account_id'),
    sharedByUserId: text('shared_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('shared_integration_status_check', sql`${t.status} in ('pending', 'active', 'removing')`),
    check(
      'shared_integration_active_account_check',
      sql`${t.status} <> 'active' or ${t.connectedAccountId} is not null`,
    ),
    unique('shared_integration_workspace_toolkit_uq').on(t.workspaceId, t.toolkit),
    index('shared_integration_shared_by_idx').on(t.sharedByUserId),
  ],
);
