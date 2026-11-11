import Anthropic from '@anthropic-ai/sdk';
import { AppError } from '@/lib/errors';
import { shipLog } from '@/lib/logger';
import { captureException } from '@/lib/observability';
import 'server-only';
import { requireAnthropicClient } from '@/features/agents';
import { normalizeOutcomeEvaluations } from '../lib/review-outcome';
import { classifyReviewRetrieveStatus } from '../lib/review-retrieve-error';
import type { ReviewOutcome } from '../types';
import { persistTaskReview } from './task-review-transitions';

type ReviewResult =
  | { handled: true; reviewOutcome: ReviewOutcome }
  | {
      handled: false;
      reason:
        | 'duplicate'
        | 'non_terminal'
        | 'not_a_task_run'
        | 'retrieve_failed'
        | 'unknown_session';
    };

const INCOMPLETE_REVIEW_RESULTS = new Set(['failed', 'interrupted']);

/** Retrieve the terminal outcome state and persist its user-facing run verdict. */
export async function recordTaskRunReview(input: {
  anthropicSessionId: string;
  webhookEventId: string;
}): Promise<ReviewResult> {
  const retrieved = await retrieveReviewedSession(input.anthropicSessionId);
  if (!retrieved.handled) return retrieved;
  const anthropicSession = retrieved.session;
  const evaluations = normalizeOutcomeEvaluations(anthropicSession.outcome_evaluations);
  const terminalEvaluation = evaluations
    .toSorted((a, b) => b.iteration - a.iteration)
    .find((candidate) => candidate.reviewOutcome !== null);
  if (!terminalEvaluation?.reviewOutcome) {
    const incompleteResults = evaluations
      .map(({ result }) => result)
      .filter((result): result is string =>
        result === null ? false : INCOMPLETE_REVIEW_RESULTS.has(result),
      );
    shipLog({
      ...(incompleteResults.length > 0 ? { level: 'warn' as const } : {}),
      msg: 'task_run.review.non_terminal',
      feature: 'tasks',
      op: 'record-review',
      session_id: input.anthropicSessionId,
      evaluation_results: evaluations.map(({ result }) => result),
      incomplete_results: incompleteResults,
    });
    return { handled: false, reason: 'non_terminal' };
  }

  const claimed = await persistTaskReview(input, anthropicSession, terminalEvaluation);
  if (claimed.length === 0) return { handled: false, reason: 'duplicate' };

  shipLog({
    msg: 'task_run.review_recorded',
    feature: 'tasks',
    op: 'record-review',
    task_id: claimed.at(0)?.taskId,
    session_id: input.anthropicSessionId,
    webhook_event_id: input.webhookEventId,
    review_outcome: terminalEvaluation.reviewOutcome,
  });
  return { handled: true, reviewOutcome: terminalEvaluation.reviewOutcome };
}

async function retrieveReviewedSession(anthropicSessionId: string) {
  const client = requireAnthropicClient();

  let anthropicSession;
  try {
    anthropicSession = await client.beta.sessions.retrieve(anthropicSessionId);
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      const action = classifyReviewRetrieveStatus(error.status);
      if (action === 'unknown_session') {
        shipLog({
          level: 'warn',
          msg: 'task_run.review.unknown_session',
          feature: 'tasks',
          op: 'record-review',
          session_id: anthropicSessionId,
          status: error.status,
        });
        return { handled: false, reason: 'unknown_session' } as const;
      }
      // Permanent provider rejections are acknowledged so webhook redelivery does not loop.
      if (action === 'graceful') {
        captureException(error, {
          feature: 'tasks',
          op: 'record-review-retrieve',
          sessionId: anthropicSessionId,
          status: error.status,
        });
        return { handled: false, reason: 'retrieve_failed' } as const;
      }
    }
    throw new AppError(
      'EXTERNAL_API_FAILED',
      'Could not retrieve the reviewed Anthropic session',
      { anthropicSessionId },
      { cause: error },
    );
  }

  return { handled: true, session: anthropicSession } as const;
}
