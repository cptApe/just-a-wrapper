export type ReviewRetrieveErrorAction = 'graceful' | 'retry' | 'unknown_session';

export function classifyReviewRetrieveStatus(
  status: number | undefined,
): ReviewRetrieveErrorAction {
  if (status === 404) return 'unknown_session';
  if (status !== undefined && status >= 400 && status < 500) return 'graceful';
  return 'retry';
}
