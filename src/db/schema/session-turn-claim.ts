import { index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { session } from './session';

// One row per completed turn the relay reported to analytics. The terminal event id keeps two
// attached tabs from reporting one turn twice, and the previous claim's time bounds the next
// turn's spend.
export const sessionTurnClaim = pgTable(
  'session_turn_claim',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    terminalEventId: text('terminal_event_id').notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.terminalEventId] }),
    index('session_turn_claim_session_claimed_idx').on(t.sessionId, t.claimedAt),
  ],
);
