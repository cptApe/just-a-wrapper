import { claimSessionResume } from '@/features/billing/api/claim-session-resume';
import { workspaceCreditBalance } from '@/features/billing/lib/workspace-credit-balance';
import { assertSessionActor } from '@/features/sessions/api/assert-session-actor';
import type { SessionWriteGrant } from '@/features/sessions/api/session-access';
import { getLiveCreditBalance } from './credit-ledger';
// A failed resume restores its pause; one failed session must not prevent other eligible sessions resuming.

import { and, desc, eq, gte, inArray, isNull, or } from 'drizzle-orm';
import { db } from '@/db';
import { session as sessionTable, workspace } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { CREDITS_EXHAUSTED_MESSAGE } from '@/lib/credits-copy';
import 'server-only';

import { publishSessionEvent } from '@/features/realtime/api/publish';
import { sendMessage } from '@/features/sessions/api/send-message';
import {
  finishSessionResume,
  transitionSession,
} from '@/features/sessions/api/session-transitions';
import { isSessionSendRefused } from '@/features/sessions/lib/session-send-refusal';
import { BillingError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { capabilities } from '@/lib/runtime-capabilities';
import { AUTO_RESUME_CUTOFF_MS, requireSessionBudgetRefresh } from './sync-session-budgets';

export const RESUME_MESSAGE_TEXT = 'Credits topped up. Please continue with my previous request.';

export type ResumedSession = {
  sessionId: string;
  anthropicSessionId: string;
  visibility: 'private' | 'workspace';
  createdByUserId: string;
};
type ResumeOptions = { budgetRaisedSessionIds: string[] };

export async function resumePausedSessions(
  workspaceId: string,
  options: ResumeOptions,
): Promise<ResumedSession[]> {
  if ((await getLiveCreditBalance(workspaceId)) <= 0) return [];
  const rows = await db
    .select()
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.workspaceId, workspaceId),
        eq(sessionTable.status, 'paused_no_credits'),
        gte(sessionTable.pausedAt, new Date(Date.now() - AUTO_RESUME_CUTOFF_MS)),
        or(
          eq(sessionTable.pausedReason, 'credits'),
          options.budgetRaisedSessionIds.length > 0
            ? and(
                eq(sessionTable.pausedReason, 'budget'),
                inArray(sessionTable.anthropicSessionId, options.budgetRaisedSessionIds),
              )
            : undefined,
        ),
        isNull(sessionTable.hiddenAt),
      ),
    )
    .orderBy(desc(sessionTable.pausedAt))
    .limit(25);
  const resumed: ResumedSession[] = [];
  const results = await Promise.allSettled(
    rows.map(async (row) => {
      if (!row.anthropicSessionId) return;
      const result = await resumePausedSession({
        workspaceId,
        anthropicSessionId: row.anthropicSessionId,
        refreshBudget: false,
      }).catch((error: unknown) => {
        // A chat that finds the workspace at its chats-at-once limit stays paused for its Resume.
        if (error instanceof BillingError && error.code === 'PLAN_LIMIT_REACHED') return null;
        throw error;
      });
      if (result)
        resumed.push({ sessionId: row.id, anthropicSessionId: row.anthropicSessionId, ...result });
    }),
  );
  for (const result of results) {
    if (result.status === 'rejected')
      captureException(result.reason, {
        feature: 'billing',
        op: 'resume-paused-session',
        workspaceId,
      });
  }
  return resumed;
}

async function resumePausedSession(input: {
  workspaceId: string;
  anthropicSessionId: string;
  refreshBudget: boolean;
}) {
  const owner = (
    await db
      .select({ id: sessionTable.id, userId: sessionTable.createdByUserId })
      .from(sessionTable)
      .where(
        and(
          eq(sessionTable.workspaceId, input.workspaceId),
          eq(sessionTable.anthropicSessionId, input.anthropicSessionId),
        ),
      )
      .limit(1)
  ).at(0);
  if (!owner) return null;
  await assertSessionActor(owner.id, owner.userId);
  const claim = await claimSessionResume(input);
  if (!claim) return null;
  try {
    if (input.refreshBudget) {
      try {
        await requireSessionBudgetRefresh(input.workspaceId, input.anthropicSessionId);
      } catch (error) {
        await finishSessionResume(claim, 'paused_no_credits');
        throw error;
      }
    }
    const client = requireAnthropicClient();
    const current =
      claim.pausedReason === 'budget'
        ? await client.beta.sessions.retrieve(input.anthropicSessionId)
        : null;
    if (current?.status === 'terminated') {
      await transitionSession({
        executor: db,
        where: eq(sessionTable.id, claim.id),
        to: 'terminated',
        expected: { status: 'resuming', version: claim.stateVersion },
        pause: null,
        activity: null,
      });
      return null;
    }
    if (!current || current.status === 'idle')
      await sendMessage({
        sessionId: input.anthropicSessionId,
        text: RESUME_MESSAGE_TEXT,
        origin: 'system',
      });
    const moved = await finishSessionResume(claim, 'running');
    if (!moved) return null;
  } catch (error) {
    if (isSessionSendRefused(error)) await finishSessionResume(claim, 'paused_no_credits');
    throw error;
  }
  return { visibility: claim.visibility, createdByUserId: claim.createdByUserId };
}

export async function resumeSessionExplicitly(grant: SessionWriteGrant): Promise<{
  resumed: boolean;
}> {
  const localSession = await loadExplicitResumeState(grant);

  if (!localSession || localSession.status !== 'paused_no_credits') return { resumed: false };

  const resumed = await resumePausedSession({
    workspaceId: grant.workspaceId,
    anthropicSessionId: grant.anthropicSessionId,
    refreshBudget: true,
  });
  if (!resumed) return { resumed: false };

  await publishSessionEvent(
    { type: 'session_status', sessionId: grant.sessionRowId, status: 'running' },
    { organizationId: grant.organizationId, session: resumed },
  ).catch((error) =>
    captureException(error, { feature: 'billing', op: 'explicit-resume-publish' }),
  );
  return { resumed: true };
}

async function loadExplicitResumeState(input: SessionWriteGrant) {
  const [workspaceRows, sessionRows] = await Promise.all([
    db
      .select({ creditBalance: workspaceCreditBalance })
      .from(workspace)
      .where(eq(workspace.id, input.workspaceId))
      .limit(1),
    db
      .select({ status: sessionTable.status, pausedReason: sessionTable.pausedReason })
      .from(sessionTable)
      .where(
        and(
          eq(sessionTable.workspaceId, input.workspaceId),
          eq(sessionTable.anthropicSessionId, input.anthropicSessionId),
        ),
      )
      .limit(1),
  ]);
  const workspaceRow = workspaceRows.at(0);
  const localSession = sessionRows.at(0);
  if (!workspaceRow) {
    throw new BillingError('WORKSPACE_NOT_FOUND', 'no workspace to resume in', {
      workspaceId: input.workspaceId,
    });
  }
  if (capabilities.billing.kind === 'stripe' && workspaceRow.creditBalance <= 0) {
    throw new BillingError('CREDITS_EXHAUSTED', CREDITS_EXHAUSTED_MESSAGE, {
      workspaceId: input.workspaceId,
      balance: workspaceRow.creditBalance,
      expectedState: true,
    });
  }

  return localSession;
}
