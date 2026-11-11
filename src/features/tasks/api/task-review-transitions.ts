import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { recordReviewedSession } from '@/features/sessions/api/session-transitions';
import type { normalizeOutcomeEvaluations } from '../lib/review-outcome';
import { claimTaskEvent } from './task-event-transitions';

export async function persistTaskReview(
  input: { anthropicSessionId: string; webhookEventId: string },
  upstream: Pick<
    Anthropic.Beta.BetaManagedAgentsSession,
    'id' | 'metadata' | 'deployment_id' | 'status' | 'created_at' | 'resources'
  >,
  terminalEvaluation: ReturnType<typeof normalizeOutcomeEvaluations>[number],
) {
  return db.transaction(async (tx) => {
    if (
      !(await claimTaskEvent(tx, {
        eventId: input.webhookEventId,
        eventType: 'session.outcome_evaluation_ended',
        payload: {
          sessionId: input.anthropicSessionId,
          outcomeId: terminalEvaluation.outcomeId,
          result: terminalEvaluation.result,
          iteration: terminalEvaluation.iteration,
        },
      }))
    )
      return [];
    const sessionRowId = await recordReviewedSession(tx, upstream);
    if (sessionRowId === null) return [];
    const outcome = terminalEvaluation.reviewOutcome;
    if (outcome === null) return [];
    return (
      tx
        .update(sessionTable)
        // No realtime publish: background review verdicts appear on the next scheduled-page load.
        .set({ reviewOutcome: terminalEvaluation.reviewOutcome })
        .where(and(eq(sessionTable.id, sessionRowId), isNull(sessionTable.reviewOutcome)))
        .returning({ id: sessionTable.id, taskId: sessionTable.taskId })
    );
  });
}
