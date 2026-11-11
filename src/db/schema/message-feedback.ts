import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from './auth';
import { session } from './session';
import { workspace } from './workspace';

// Feedback we collect, one table, two kinds discriminated by `kind`:
//   'message' — thumbs up/down on an assistant response. Keyed to
//               a session + the rated message's Anthropic event id (`sevt_…`),
//               carries a rating, and is also forwarded to the agent as a
//               `system.message` (no new turn). Exactly ONE row per vote
//               identity (session + event + user): a later post upserts the
//               rating and/or comment onto the same row (see the partial unique
//               index below and `submit-feedback.ts`).
//   'app'     — freeform product feedback from the account menu's "Leave
//               feedback". No session, no rating: the `body` is the
//               feedback and `route` is the pathname it was sent from.
// The kinds share only the envelope (workspace, user, created_at); the shape
// columns are nullable and re-required per kind by CHECK constraints below, so
// the message invariants survive byte-for-byte (a 'message' row still MUST have
// session + event + rating) while 'app' rows fill body + route instead.
export const messageFeedback = pgTable(
  'message_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Discriminator: which kind of feedback this row is. */
    kind: text('kind').$type<'message' | 'app'>().notNull().default('message'),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspace.id),
    /** 'message' only — the rated response's session (null for 'app'). */
    sessionId: uuid('session_id').references(() => session.id),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** 'message' only — the rated assistant message's Anthropic event id. */
    anthropicEventId: text('anthropic_event_id'),
    /** 'message' only — the thumbs rating. */
    rating: text('rating').$type<'up' | 'down'>(),
    /** 'message' only — an optional note attached to a thumbs rating. */
    comment: text('comment'),
    /** 'app' only — the freeform feedback text. */
    body: text('body'),
    /** 'app' only — the route/pathname the feedback was sent from. */
    route: text('route'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('message_feedback_session_id_idx').on(t.sessionId),
    index('message_feedback_workspace_id_created_at_idx').on(t.workspaceId, t.createdAt),
    // One vote per (session, event, user): the upsert conflict target. Partial
    // to 'message' rows — 'app' rows carry null session/event and never collide
    // (and would otherwise share a null-key triple). The write path's
    // onConflictDoUpdate mirrors this predicate as its targetWhere.
    uniqueIndex('message_feedback_message_vote_uidx')
      .on(t.sessionId, t.anthropicEventId, t.userId)
      .where(sql`${t.kind} = 'message'`),
    check('message_feedback_kind_check', sql`${t.kind} in ('message', 'app')`),
    check('message_feedback_rating_check', sql`${t.rating} in ('up', 'down')`),
    check('message_feedback_comment_length_check', sql`char_length(${t.comment}) <= 2000`),
    check('message_feedback_body_length_check', sql`char_length(${t.body}) <= 4000`),
    // A 'message' row keeps its original invariant: session + event + rating are
    // all present. (kind <> 'message' short-circuits the requirement for 'app'.)
    check(
      'message_feedback_message_shape_check',
      sql`${t.kind} <> 'message' or (${t.sessionId} is not null and ${t.anthropicEventId} is not null and ${t.rating} is not null)`,
    ),
    // An 'app' row carries its own required fields: the body, and the route it
    // was sent from.
    check(
      'message_feedback_app_shape_check',
      sql`${t.kind} <> 'app' or (${t.body} is not null and ${t.route} is not null)`,
    ),
  ],
);
