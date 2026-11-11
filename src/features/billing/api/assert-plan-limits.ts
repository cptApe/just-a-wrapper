import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { session, workspace } from '@/db/schema';
import { CHAT_SLOT_STATUSES } from '@/features/sessions/lib/session-machine';
import { BillingError } from '@/lib/errors';
import 'server-only';
import { chatsAtOnceExceeded, chatsAtOnceMessage } from '../lib/plan-gates';
import type { WorkspacePlan } from '../pricing-config';
import type { BillingTx } from './credit-ledger';
import { limitRefusal } from './plan-limits';

// Use the caller transaction so count and insert serialize; advisory namespace 3 avoids credit-ledger lock contention.
export async function lockAndLoadPlan(
  tx: BillingTx,
  workspaceId: string,
): Promise<WorkspacePlan | null> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${workspaceId}, 3))`);
  const workspaceRow = (
    await tx
      .select({ planTier: workspace.planTier })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)
  ).at(0);
  return workspaceRow?.planTier ?? null;
}

// The caller holds the capacity lock through its session insert.
export async function assertCanStartChat(workspaceId: string, tx: BillingTx): Promise<void> {
  const plan = await lockAndLoadPlan(tx, workspaceId);
  if (plan === null) return;
  const refusal = await limitRefusal(plan);
  const { limits } = refusal;
  const row = (
    await tx
      .select({ running: count() })
      .from(session)
      .where(
        and(
          eq(session.workspaceId, workspaceId),
          inArray(session.status, CHAT_SLOT_STATUSES),
          eq(session.kind, 'chat'),
          isNull(session.hiddenAt),
        ),
      )
  ).at(0);
  const running = row?.running ?? 0;
  if (!chatsAtOnceExceeded(running, limits)) return;
  throw new BillingError('PLAN_LIMIT_REACHED', chatsAtOnceMessage(refusal), {
    workspaceId,
    plan,
    running,
    limit: limits.chatsAtOnce,
  });
}
