// Workspace leases coordinate budget updates across servers; failed batches remain pending for the sweep.

import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { after } from 'next/server';
import { db } from '@/db';
import { session as sessionTable, task } from '@/db/schema';
import { requireAnthropicClient } from '@/features/agents';
import { sessionBudgetForCreditBalance } from '@/features/billing/lib/session-budget-value';
import { CREDITS_EXHAUSTED_MESSAGE } from '@/lib/credits-copy';
import { BillingError, IntegrationError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { snapshotCtx, withRequestContext } from '@/lib/request-context';
import { capabilities } from '@/lib/runtime-capabilities';
import 'server-only';
import { NotFoundError } from '@anthropic-ai/sdk';

export const AUTO_RESUME_CUTOFF_MS = 30 * 60_000;

const SESSION_UPDATE_CONCURRENCY = 5;

type SessionBudgetSyncResult = {
  updatedSessionIds: string[];
  failedSessionIds: string[];
  failedDeploymentIds: string[];
};

type AnthropicClient = ReturnType<typeof requireAnthropicClient>;

import {
  claimBudgetSync,
  finishBudgetSync,
  renewBudgetSyncLease,
  requestBudgetSync,
} from './budget-sync-transitions';
import { readSpendAllowance, spendableCredits } from './spend-gate';

type BudgetSyncSession = { anthropicSessionId: string; unattendedCreatorId: string | null };

// A task run is capped at its creator's remaining member allowance; a chat at the balance.
async function readSpendableCredits(workspaceId: string, unattendedCreatorId: string | null) {
  const allowance = await db.transaction((tx) =>
    readSpendAllowance(tx, { workspaceId, userId: unattendedCreatorId }),
  );
  return { balance: allowance.balance, spendable: spendableCredits(allowance) };
}

function monetaryAmountInCents(amount: string | undefined): number | null {
  if (!amount || !/^(0|[1-9]\d*)$/.test(amount)) return null;
  const cents = Number(amount);
  return Number.isSafeInteger(cents) ? cents : null;
}

async function updateSessionBudget(input: {
  client: AnthropicClient;
  workspaceId: string;
  anthropicSessionId: string;
  creditBalance: number;
}): Promise<void> {
  try {
    const upstream = await input.client.beta.sessions.retrieve(
      input.anthropicSessionId,
      undefined,
      { timeout: 30_000, maxRetries: 0 },
    );
    // An unused session may omit list_cost; missing usage is zero consumed cost, not the previous cap.
    const consumed = monetaryAmountInCents(upstream.usage.list_cost?.amount) ?? 0;
    const budget = sessionBudgetForCreditBalance(input.creditBalance, consumed);
    await input.client.beta.sessions.update(
      input.anthropicSessionId,
      { budget },
      { timeout: 30_000, maxRetries: 0 },
    );
  } catch (error) {
    // A deleted upstream session has no budget left to synchronize.
    if (error instanceof NotFoundError) return;
    throw new IntegrationError(
      'EXTERNAL_API_FAILED',
      'Could not raise the Anthropic session budget',
      { workspaceId: input.workspaceId, anthropicSessionId: input.anthropicSessionId },
      { cause: error },
    );
  }
}

async function syncWorkspaceSessionBudgetsOnce(
  workspaceId: string,
  token: string,
): Promise<SessionBudgetSyncResult> {
  const [{ balance }, rows] = await Promise.all([
    readSpendableCredits(workspaceId, null),
    listBudgetSyncSessions(workspaceId),
  ]);
  // Deployment templates must follow grants even when no run session exists yet.
  const deployments = await db
    .select({ id: sql<string>`${task.anthropicDeploymentId}` })
    .from(task)
    .where(
      and(
        eq(task.workspaceId, workspaceId),
        isNotNull(task.anthropicDeploymentId),
        isNull(task.runAt),
        inArray(task.status, ['upcoming', 'paused', 'running']),
      ),
    );
  const failedDeploymentIds: string[] = [];
  for (const deployment of deployments) {
    try {
      await requireAnthropicClient().beta.deployments.update(
        deployment.id,
        {
          budget: sessionBudgetForCreditBalance(balance, 0),
        },
        { timeout: 30_000, maxRetries: 0 },
      );
    } catch (error) {
      failedDeploymentIds.push(deployment.id);
      captureException(error, {
        feature: 'billing',
        op: 'sync-deployment-budget',
        workspaceId,
        deploymentId: deployment.id,
      });
    }
  }
  if (balance <= 0) return { updatedSessionIds: [], failedSessionIds: [], failedDeploymentIds };
  const sessions = await withSpendableCredits(workspaceId, balance, rows);
  if (sessions.length === 0)
    return { updatedSessionIds: [], failedSessionIds: [], failedDeploymentIds };
  const client = requireAnthropicClient();
  const updatedSessionIds: string[] = [];
  const failedSessionIds: string[] = [];

  for (let offset = 0; offset < sessions.length; offset += SESSION_UPDATE_CONCURRENCY) {
    if (!(await renewBudgetSyncLease(workspaceId, token)))
      throw new BillingError('CONFLICT', 'Session budget sync lost its lease', { workspaceId });
    const batch = sessions.slice(offset, offset + SESSION_UPDATE_CONCURRENCY);
    await Promise.all(
      batch.map(async ({ anthropicSessionId, spendable }) => {
        try {
          await updateSessionBudget({
            client,
            workspaceId,
            anthropicSessionId,
            creditBalance: spendable,
          });
          updatedSessionIds.push(anthropicSessionId);
        } catch (error) {
          failedSessionIds.push(anthropicSessionId);
          captureException(error, {
            feature: 'billing',
            op: 'sync-session-budget',
            workspaceId,
            anthropicSessionId,
          });
        }
      }),
    );
  }

  return { updatedSessionIds, failedSessionIds, failedDeploymentIds };
}

// A run whose creator has no allowance left keeps its budget, so a grant never resumes it into
// an immediate stop; the creator's next period or a raised limit lets the resume path start it.
async function withSpendableCredits(
  workspaceId: string,
  balance: number,
  rows: BudgetSyncSession[],
): Promise<{ anthropicSessionId: string; spendable: number }[]> {
  const byCreator = new Map<string, number>();
  for (const creator of new Set(rows.flatMap((row) => row.unattendedCreatorId ?? [])))
    byCreator.set(creator, (await readSpendableCredits(workspaceId, creator)).spendable);
  return rows.flatMap((row) => {
    const spendable =
      row.unattendedCreatorId === null ? balance : (byCreator.get(row.unattendedCreatorId) ?? 0);
    return spendable > 0 ? [{ anthropicSessionId: row.anthropicSessionId, spendable }] : [];
  });
}

export async function drainWorkspaceBudgetSync(
  workspaceId: string,
): Promise<SessionBudgetSyncResult> {
  if (capabilities.billing.kind === 'off')
    return { updatedSessionIds: [], failedSessionIds: [], failedDeploymentIds: [] };
  const updated = new Set<string>();
  const failed = new Set<string>();
  const failedDeployments = new Set<string>();
  for (;;) {
    const claim = await claimBudgetSync(workspaceId);
    if (!claim)
      return {
        updatedSessionIds: [...updated],
        failedSessionIds: [...failed],
        failedDeploymentIds: [...failedDeployments],
      };
    let result: SessionBudgetSyncResult;
    try {
      result = await syncWorkspaceSessionBudgetsOnce(workspaceId, claim.token);
    } catch (cause) {
      await finishBudgetSync({ workspaceId, ...claim, failed: true });
      throw new BillingError(
        'EXTERNAL_API_FAILED',
        'Workspace session budgets could not be synchronized',
        { workspaceId },
        { cause },
      );
    }
    for (const id of result.updatedSessionIds) {
      updated.add(id);
      failed.delete(id);
    }
    for (const id of result.failedSessionIds) failed.add(id);
    for (const id of result.failedDeploymentIds) failedDeployments.add(id);
    const moved = await finishBudgetSync({
      workspaceId,
      ...claim,
      failed: result.failedSessionIds.length > 0 || result.failedDeploymentIds.length > 0,
    });
    if (!moved || result.failedSessionIds.length > 0 || result.failedDeploymentIds.length > 0)
      return {
        updatedSessionIds: [...updated],
        failedSessionIds: [...failed],
        failedDeploymentIds: [...failedDeployments],
      };
  }
}

export async function syncWorkspaceSessionBudgetsAfterGrant(
  workspaceId: string,
): Promise<SessionBudgetSyncResult> {
  await requestBudgetSync(db, workspaceId);
  return drainWorkspaceBudgetSync(workspaceId);
}

// The grant transaction already queued this work; the sweep recovers unavailable request scheduling.
export function scheduleWorkspaceSessionBudgetsAfterGrant(workspaceId: string): void {
  try {
    const snapshot = snapshotCtx();
    after(() =>
      withRequestContext(snapshot, async () => {
        await drainWorkspaceBudgetSync(workspaceId);
      }),
    );
  } catch (error) {
    captureException(error, { feature: 'billing', op: 'schedule-session-budget-sync' });
  }
}

export async function requireSessionBudgetRefresh(
  workspaceId: string,
  anthropicSessionId: string,
): Promise<boolean> {
  const localSession = (
    await db
      .select({
        status: sessionTable.status,
        kind: sessionTable.kind,
        createdByUserId: sessionTable.createdByUserId,
      })
      .from(sessionTable)
      .where(
        and(
          eq(sessionTable.workspaceId, workspaceId),
          eq(sessionTable.anthropicSessionId, anthropicSessionId),
        ),
      )
      .limit(1)
  ).at(0);

  // A local termination is final.
  if (!localSession || localSession.status === 'terminated') return false;
  if (capabilities.billing.kind === 'off') return true;
  const { balance, spendable } = await readSpendableCredits(
    workspaceId,
    localSession.kind === 'task_run' ? localSession.createdByUserId : null,
  );
  if (balance <= 0) {
    throw new BillingError('CREDITS_EXHAUSTED', CREDITS_EXHAUSTED_MESSAGE, {
      workspaceId,
      balance,
      expectedState: true,
    });
  }

  await updateSessionBudget({
    client: requireAnthropicClient(),
    workspaceId,
    anthropicSessionId,
    creditBalance: spendable,
  });
  return true;
}

async function listBudgetSyncSessions(workspaceId: string): Promise<BudgetSyncSession[]> {
  const rows = await db
    .select({
      anthropicSessionId: sessionTable.anthropicSessionId,
      kind: sessionTable.kind,
      createdByUserId: sessionTable.createdByUserId,
    })
    .from(sessionTable)
    .where(
      and(
        eq(sessionTable.workspaceId, workspaceId),
        isNotNull(sessionTable.anthropicSessionId),
        or(
          inArray(sessionTable.status, ['running', 'opening', 'resuming']),
          and(
            eq(sessionTable.status, 'paused_no_credits'),
            gte(sessionTable.pausedAt, new Date(Date.now() - AUTO_RESUME_CUTOFF_MS)),
            or(eq(sessionTable.pausedReason, 'credits'), eq(sessionTable.pausedReason, 'budget')),
          ),
        ),
      ),
    )
    .orderBy(desc(sql`coalesce(${sessionTable.lastEventAt}, ${sessionTable.createdAt})`));
  return rows.flatMap((row) =>
    row.anthropicSessionId
      ? [
          {
            anthropicSessionId: row.anthropicSessionId,
            unattendedCreatorId: row.kind === 'task_run' ? row.createdByUserId : null,
          },
        ]
      : [],
  );
}
