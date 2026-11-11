import { index, integer, numeric, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { session } from './session';

// Raw spans, kept apart from recorded usage: a cumulative snapshot can bill a span's tokens before
// the span arrives, and the sum of raw spans is what lets the late span charge only what is left.
export const modelUsageObservation = pgTable(
  'model_usage_observation',
  {
    eventId: text('event_id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheCreationTokens: integer('cache_creation_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull(),
    vendorCostCents: numeric('vendor_cost_cents', {
      precision: 20,
      scale: 6,
      mode: 'number',
    }).notNull(),
  },
  (table) => [index('model_usage_observation_session_idx').on(table.sessionId)],
);
