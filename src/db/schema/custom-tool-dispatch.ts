import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { session } from './session';

// Durable at-most-once claim for an Anthropic custom_tool_use event. The route
// inserts this before executing a handler, so concurrent/replayed POSTs cannot
// run the same side effect twice even before Anthropic receives the result.
export const customToolDispatch = pgTable(
  'custom_tool_dispatch',
  {
    toolUseId: text('tool_use_id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    toolName: text('tool_name').notNull(),
    // awaiting_decision: parked for a person; claimed: about to run (toolDeliveryMachine).
    status: text('status')
      .$type<
        | 'awaiting_decision'
        | 'claimed'
        | 'executing'
        | 'ready'
        | 'delivering'
        | 'delivered'
        | 'completed'
        | 'abandoned'
      >()
      .notNull()
      .default('claimed'),
    delivery: jsonb('delivery'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('custom_tool_dispatch_recovery_idx').on(t.status, t.updatedAt),
    index('custom_tool_dispatch_session_id_idx').on(t.sessionId),
    check(
      'custom_tool_dispatch_status_check',
      sql`${t.status} in ('awaiting_decision', 'claimed', 'executing', 'ready', 'delivering', 'delivered', 'completed', 'abandoned')`,
    ),
    check(
      'custom_tool_dispatch_delivery_check',
      sql`(${t.status} in ('awaiting_decision', 'claimed', 'executing') and ${t.delivery} is null) or (${t.status} in ('ready', 'delivering', 'delivered') and ${t.delivery} is not null) or ${t.status} in ('completed', 'abandoned')`,
    ),
  ],
);
