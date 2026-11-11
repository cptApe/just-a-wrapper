import type { BetaManagedAgentsOutcomeEvaluationResource } from '@anthropic-ai/sdk/resources/beta/sessions/sessions';
import type { ReviewOutcome } from '../types';

export type NormalizedOutcomeEvaluation = {
  outcomeId: string | null;
  result: string | null;
  iteration: number;
  reviewOutcome: ReviewOutcome | null;
};

function normalizeOutcomeEvaluation(
  input: BetaManagedAgentsOutcomeEvaluationResource,
): NormalizedOutcomeEvaluation {
  const { result, iteration } = input;
  const reviewOutcome =
    result === 'satisfied'
      ? iteration === 0
        ? 'passed'
        : 'passed_after_revision'
      : result === 'max_iterations_reached'
        ? 'not_passed'
        : null;

  return {
    outcomeId: input.outcome_id,
    result,
    iteration,
    reviewOutcome,
  };
}

export function normalizeOutcomeEvaluations(
  input: BetaManagedAgentsOutcomeEvaluationResource[],
): NormalizedOutcomeEvaluation[] {
  return input.map(normalizeOutcomeEvaluation);
}
