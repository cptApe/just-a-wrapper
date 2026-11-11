import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { messageFeedback } from '@/db/schema';
// Direct module import (not the agents barrel): the barrel re-exports React
// components; this server module needs only the SDK client.
import { requireAnthropicClient } from '@/features/agents/api/anthropic-client';
import type { SessionWriteGrant } from '@/features/sessions/api/session-access';
import { captureException } from '@/lib/observability';
import { extend } from '@/lib/request-context';

// Persist one feedback row per session, event and user; upsert optional notes.
// Feed the agent a system.message only when final is true, after the note choice,
// so one rating produces one context update without starting a user turn.

export type FeedbackInput = {
  // Rating feeds the agent session, which only its creator may steer.
  grant: SessionWriteGrant;
  /** The rated assistant message's Anthropic event id. */
  eventId: string;
  rating: 'up' | 'down';
  comment?: string;

  // Only the resolved vote/note decision feeds the agent, so a two-request vote sends one update.
  final: boolean;
};

/** `delivered` is true only when the note reached the agent's session. */
export async function submitMessageFeedback(input: FeedbackInput): Promise<{ delivered: boolean }> {
  extend({ session_id: input.grant.anthropicSessionId });

  // Omitted comments preserve the saved note; dismissing the note dialog must not erase it.
  const conflictSet: { rating: 'up' | 'down'; comment?: string } = { rating: input.rating };
  if (input.comment !== undefined) conflictSet.comment = input.comment;

  // The conflict predicate must match the partial message-vote index; app feedback is a separate kind.
  await db
    .insert(messageFeedback)
    .values({
      kind: 'message',
      workspaceId: input.grant.workspaceId,
      sessionId: input.grant.sessionRowId,
      userId: input.grant.userId,
      anthropicEventId: input.eventId,
      rating: input.rating,
      comment: input.comment ?? null,
    })
    .onConflictDoUpdate({
      target: [messageFeedback.sessionId, messageFeedback.anthropicEventId, messageFeedback.userId],
      targetWhere: sql`${messageFeedback.kind} = 'message'`,
      set: conflictSet,
    });

  // Feed the agent exactly once per decision: only the resolving post carries
  // final=true. The bare vote persists silently so a vote+note is one feed.
  if (!input.final) return { delivered: false };

  // Saved feedback remains accepted even when the session rejects its context update.
  try {
    await feedAgent(input);
    return { delivered: true };
  } catch (error) {
    captureException(error, {
      feature: 'feedback',
      op: 'feed-agent',
      sessionId: input.grant.anthropicSessionId,
    });
    return { delivered: false };
  }
}

async function feedAgent(input: FeedbackInput): Promise<void> {
  const client = requireAnthropicClient();
  const tone = input.rating === 'up' ? 'positively' : 'negatively';
  const note =
    `The user rated one of your recent responses ${tone}.` +
    (input.comment ? ` Their note: "${input.comment}".` : '') +
    ' Adjust the rest of this session accordingly. Do not reply to this message.';
  await client.beta.sessions.events.send(input.grant.anthropicSessionId, {
    events: [{ type: 'system.message', content: [{ type: 'text', text: note }] }],
  });
}
