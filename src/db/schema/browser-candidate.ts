import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { session } from './session';

// Written before a Browserbase session is created and deleted once the browser is owned by the
// session row or released and billed. A row past its lease is swept, so a killed process can
// never leave a paid browser running untracked.
export const browserCandidate = pgTable(
  'browser_candidate',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    // The tool the browser time is billed under.
    toolName: text('tool_name').$type<'browse_open' | 'browse_page'>().notNull(),
    // creating: the provider id is not known yet, so the sweep finds it by its metadata tag.
    status: text('status').$type<'creating' | 'created'>().notNull().default('creating'),
    browserbaseSessionId: text('browserbase_session_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('browser_candidate_created_at_idx').on(t.createdAt),
    index('browser_candidate_session_id_idx').on(t.sessionId),
    uniqueIndex('browser_candidate_browserbase_session_id_uidx').on(t.browserbaseSessionId),
    check(
      'browser_candidate_tool_name_check',
      sql`${t.toolName} in ('browse_open', 'browse_page')`,
    ),
    check('browser_candidate_status_check', sql`${t.status} in ('creating', 'created')`),
    check(
      'browser_candidate_identity_check',
      sql`(${t.status} = 'creating') = (${t.browserbaseSessionId} is null)`,
    ),
  ],
);
