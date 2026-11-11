import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { captureException } from '@/lib/observability';

export type UpstreamSessionDeletionResult = {
  deleted: number;
  alreadyGone: number;
  failed: number;
  deferred: number;
  completedIds: string[];
};

// Provider failures leave local identities intact for the next bounded purge pass.
export async function deleteSessionsUpstream(
  client: Anthropic,
  sessionIds: string[],
  deadline: number,
): Promise<UpstreamSessionDeletionResult> {
  const result: UpstreamSessionDeletionResult = {
    deleted: 0,
    alreadyGone: 0,
    failed: 0,
    deferred: 0,
    completedIds: [],
  };

  for (const sessionId of sessionIds) {
    if (Date.now() >= deadline) {
      result.deferred = sessionIds.length - result.deleted - result.alreadyGone - result.failed;
      break;
    }
    try {
      await client.beta.sessions.delete(sessionId, undefined, {
        timeout: Math.min(10_000, deadline - Date.now()),
        maxRetries: 0,
      });
      result.completedIds.push(sessionId);
      result.deleted += 1;
    } catch (error) {
      if (error instanceof Anthropic.APIError && error.status === 404) {
        result.alreadyGone += 1;
        result.completedIds.push(sessionId);
        continue;
      }

      captureException(error, {
        feature: 'workspaces',
        op: 'purge.session-upstream',
        sessionId,
      });
      result.failed += 1;
    }
  }

  return result;
}
