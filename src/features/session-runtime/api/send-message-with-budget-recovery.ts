import { APIError } from '@anthropic-ai/sdk';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable } from '@/db/schema';
import { getAnthropicClient } from '@/features/agents';
import { claimSessionResume } from '@/features/billing/api/claim-session-resume';
import { requireSessionBudgetRefresh } from '@/features/billing/api/sync-session-budgets';
import {
  type SendMessageInput,
  type SentMessageEcho,
  sendMessage,
} from '@/features/sessions/api/send-message';
import { finishSessionResume } from '@/features/sessions/api/session-transitions';
import { isSessionSendRefused } from '@/features/sessions/lib/session-send-refusal';
import { AppError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import 'server-only';

async function isBudgetReachedSendError(sessionId: string, error: unknown): Promise<boolean> {
  if (!(error instanceof APIError) || error.status !== 400) return false;
  const detail = `${error.message} ${JSON.stringify(error.error)}`.toLowerCase();
  if (
    detail.includes('budget_reached') ||
    detail.includes('budget reached') ||
    detail.includes('session budget')
  ) {
    return true;
  }
  // Anthropic documents that a capped session rejects user.message with a 400
  // naming the events it still accepts. That response need not carry the stop
  // reason, so confirm it from the latest session-level idle event.
  const client = getAnthropicClient();
  if (!client) return false;
  try {
    const page = await client.beta.sessions.events.list(sessionId, {
      limit: 1,
      order: 'desc',
      types: ['session.status_idle'],
    });
    const latest = page.data.at(0);
    return latest?.type === 'session.status_idle' && latest.stop_reason.type === 'budget_reached';
  } catch (lookupError) {
    // An inconclusive budget probe preserves the original send refusal instead of triggering a blind retry.
    captureException(lookupError, {
      feature: 'billing',
      op: 'detect-session-budget-reached',
      session_id: sessionId,
    });
    return false;
  }
}

/** Refresh the absolute upstream budget when it differs from live workspace credits.
 * A known local credit pause refreshes before send; an upstream budget rejection
 * refreshes and retries the identical send once. */
export async function sendMessageWithBudgetRecovery(
  input: SendMessageInput & { workspaceId: string },
): Promise<SentMessageEcho | null> {
  const local = (
    await db
      .select()
      .from(sessionTable)
      .where(
        and(
          eq(sessionTable.workspaceId, input.workspaceId),
          eq(sessionTable.anthropicSessionId, input.sessionId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!local || local.hiddenAt || local.status === 'terminated') {
    throw new AppError('SESSION_NOT_FOUND', 'Session not found', { sessionId: input.sessionId });
  }
  if (
    local.status === 'resuming' ||
    local.status === 'pausing' ||
    local.status === 'awaiting_opening' ||
    (local.status === 'opening' && !input.opening)
  ) {
    throw new AppError(
      'SESSION_BUSY',
      'This session is waiting for its current operation to finish.',
      { sessionId: input.sessionId },
    );
  }
  const paused = local.status === 'paused_no_credits';
  const claim = paused
    ? await claimSessionResume({
        workspaceId: input.workspaceId,
        anthropicSessionId: input.sessionId,
      })
    : null;
  if (paused && !claim)
    throw new AppError(
      'SESSION_BUSY',
      'Session cannot resume. Check the member credit limit or wait for the current operation.',
      {
        sessionId: input.sessionId,
      },
    );
  try {
    if (claim) {
      try {
        const refreshed = await requireSessionBudgetRefresh(input.workspaceId, input.sessionId);
        if (!refreshed)
          throw new AppError('SESSION_BUSY', 'Session cannot resume', {
            sessionId: input.sessionId,
          });
      } catch (error) {
        await finishSessionResume(claim, 'paused_no_credits');
        throw error;
      }
    }
    let echo: SentMessageEcho | null;
    try {
      echo = await sendMessage(input);
    } catch (error) {
      if (paused || !(await isBudgetReachedSendError(input.sessionId, error))) throw error;
      const didRefresh = await requireSessionBudgetRefresh(input.workspaceId, input.sessionId);
      if (!didRefresh) throw error;
      echo = await sendMessage(input);
    }
    if (claim) await finishSessionResume(claim, 'running');
    return echo;
  } catch (error) {
    if (claim && isSessionSendRefused(error)) await finishSessionResume(claim, 'paused_no_credits');
    throw error;
  }
}
