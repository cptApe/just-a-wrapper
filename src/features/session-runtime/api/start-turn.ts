import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { session } from '@/db/schema';
import { assertCanStartChat } from '@/features/billing/api/assert-plan-limits';
import type { BillingTx } from '@/features/billing/api/credit-ledger';
import { claimSessionOpening } from '@/features/sessions/api/claim-session-opening';
import type { SentMessageEcho } from '@/features/sessions/api/send-message';
import type { MessageOrigin } from '@/features/sessions/api/send-message-analytics';
import type { SendLease } from '@/features/sessions/api/session-send-transitions';
import {
  releaseSessionOpening,
  transitionSession,
} from '@/features/sessions/api/session-transitions';
import { isAwaitingToolResultError } from '@/features/sessions/lib/awaiting-tool-result-error';
import { isSessionSendRefused } from '@/features/sessions/lib/session-send-refusal';
import { AppError } from '@/lib/errors';
import { DurableRecoveryError } from '@/lib/recover-rows';
import { AWAITING_TOOL_RESULT_MESSAGE } from '@/lib/route-error-messages';
import {
  type DispatchPendingToolCalls,
  reconcileWorkspaceSessions,
} from './reconcile-stale-sessions';
import { sendMessageWithBudgetRecovery } from './send-message-with-budget-recovery';

// A chat turn starts at its opening and at each send to an idle chat. Both pass the plan's
// chats-at-once limit under the workspace capacity lock.

type Capacity = { workspaceId: string; dispatchPendingToolCalls: DispatchPendingToolCalls };

/** Runs `claim` under the capacity lock. A refusal reconciles stale statuses once and retries. */
export async function withChatCapacity<T>(
  capacity: Capacity,
  claim: (tx: BillingTx) => Promise<T>,
): Promise<T> {
  const attempt = () =>
    db.transaction(async (tx) => {
      await assertCanStartChat(capacity.workspaceId, tx);
      return claim(tx);
    });
  try {
    return await attempt();
  } catch (error) {
    if (!(error instanceof AppError) || error.code !== 'PLAN_LIMIT_REACHED') throw error;
    await reconcileWorkspaceSessions({ ...capacity, rateLimit: true }).catch((cause: unknown) => {
      if (!(cause instanceof DurableRecoveryError)) throw cause;
    });
    return attempt();
  }
}

/** Claims a deferred chat's opening turn, inside the chats-at-once limit. */
export function claimOpeningTurn(
  input: { sessionId: string; workspaceId: string; createdByUserId: string },
  capacity: Capacity,
): Promise<number> {
  return withChatCapacity(capacity, (tx) => claimSessionOpening(input, tx));
}

/** The one way an opening message reaches the provider, for new and deferred chats and task runs. */
export async function sendOpeningMessage(input: {
  sessionId: string;
  anthropicSessionId: string;
  workspaceId: string;
  organizationId: string;
  userId: string;
  text: string;
  origin: MessageOrigin;
  lease?: SendLease;
  // The stateVersion of the session's 'opening' claim.
  claim: number;
}): Promise<SentMessageEcho | null> {
  const echo = await sendWithGateRefusal({
    sessionId: input.anthropicSessionId,
    workspaceId: input.workspaceId,
    text: input.text,
    origin: input.origin,
    lease: input.lease,
    opening: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      organizationId: input.organizationId,
    },
  }).catch(async (error: unknown) => {
    if (isSessionSendRefused(error)) await releaseSessionOpening(input.sessionId, input.claim);
    throw error;
  });
  await transitionSession({
    executor: db,
    where: eq(session.id, input.sessionId),
    to: 'running',
    expected: { status: 'opening', version: input.claim },
    pause: null,
    activity: null,
  });
  return echo;
}

// A pending tool gate is a user-correctable pause, not an exception to report.
export async function sendWithGateRefusal(
  input: Parameters<typeof sendMessageWithBudgetRecovery>[0],
) {
  try {
    return await sendMessageWithBudgetRecovery(input);
  } catch (cause) {
    if (!isAwaitingToolResultError(cause)) throw cause;
    throw new AppError(
      'SESSION_BUSY',
      AWAITING_TOOL_RESULT_MESSAGE,
      { sessionId: input.sessionId, reason: 'awaiting-tool-result', expectedState: true },
      { cause },
    );
  }
}
