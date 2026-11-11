import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './auth';
import { session } from './session';
import { workspace } from './workspace';

// Decisions survive delivery retries; the dispatch journal owns execution and delivery.
export const pendingConfirmation = pgTable(
  'pending_confirmation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    // Anthropic's `agent.custom_tool_use` event id — what we post back as
    // `custom_tool_use_id`. UNIQUE = the idempotency key.
    toolUseId: text('tool_use_id').notNull(),
    toolName: text('tool_name').notNull(),
    // The validated tool input, replayed into the handler on approve.
    input: jsonb('input').notNull(),
    // The member whose tool call requested the action. A teammate may approve a
    // shared task, but the handler must still execute with this actor's identity.
    // The requester can be absent after account removal.
    requestedByUserId: text('requested_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    status: text('status').$type<'pending' | 'approved' | 'denied'>().notNull().default('pending'),
    decidedByUserId: text('decided_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (t) => [
    // One row per blocking event id; also the idempotency guard for confirm.
    uniqueIndex('pending_confirmation_tool_use_id_uidx').on(t.toolUseId),
    // The stepper queries a session's still-pending rows.
    index('pending_confirmation_session_id_status_idx').on(t.sessionId, t.status),
    check(
      'pending_confirmation_decision_check',
      sql`(${t.status} = 'pending' and ${t.decidedAt} is null) or (${t.status} in ('approved', 'denied') and ${t.decidedAt} is not null)`,
    ),
    check(
      'pending_confirmation_status_check',
      sql`${t.status} in ('pending', 'approved', 'denied')`,
    ),
  ],
);
