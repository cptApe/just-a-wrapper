import { randomUUID } from 'node:crypto';
import { and, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { workspace, workspaceNotDeleted } from '@/db/schema';
import { capabilities } from '@/lib/runtime-capabilities';
import { budgetSyncMachine } from '../lib/budget-sync-machine';
import type { BillingTx } from './credit-ledger';

const LEASE_MS = 5 * 60 * 1000;
export async function requestBudgetSync(
  executor: Pick<BillingTx, 'update'>,
  workspaceId: string,
): Promise<boolean> {
  if (capabilities.billing.kind === 'off') return false;
  const moved = await executor
    .update(workspace)
    .set({
      budgetSyncStatus: sql`case when ${workspace.budgetSyncStatus} = 'syncing' then 'syncing' else 'pending' end`,
      budgetSyncRevision: sql`${workspace.budgetSyncRevision} + 1`,
    })
    .where(
      and(
        eq(workspace.id, workspaceId),
        workspaceNotDeleted,
        inArray(workspace.budgetSyncStatus, budgetSyncMachine.sourcesOf('pending')),
      ),
    )
    .returning({ id: workspace.id });
  return moved.length > 0;
}

export async function claimBudgetSync(
  workspaceId: string,
): Promise<{ token: string; revision: number } | null> {
  const token = randomUUID();
  const claimed = (
    await db
      .update(workspace)
      .set({
        budgetSyncStatus: 'syncing',
        budgetSyncLease: token,
        budgetSyncLeaseUntil: new Date(Date.now() + LEASE_MS),
      })
      .where(
        and(
          eq(workspace.id, workspaceId),
          workspaceNotDeleted,
          inArray(workspace.budgetSyncStatus, budgetSyncMachine.sourcesOf('syncing')),
          or(
            eq(workspace.budgetSyncStatus, 'pending'),
            lte(workspace.budgetSyncLeaseUntil, new Date()),
          ),
        ),
      )
      .returning({ revision: workspace.budgetSyncRevision })
  ).at(0);
  return claimed ? { token, revision: claimed.revision } : null;
}

export async function renewBudgetSyncLease(workspaceId: string, token: string): Promise<boolean> {
  const moved = await db
    .update(workspace)
    .set({ budgetSyncLeaseUntil: new Date(Date.now() + LEASE_MS) })
    .where(
      and(
        eq(workspace.id, workspaceId),
        eq(workspace.budgetSyncLease, token),
        inArray(workspace.budgetSyncStatus, budgetSyncMachine.sourcesOf('syncing')),
      ),
    )
    .returning({ id: workspace.id });
  return moved.length > 0;
}

export async function finishBudgetSync(input: {
  workspaceId: string;
  token: string;
  revision: number;
  failed: boolean;
}): Promise<boolean> {
  const moved = await db
    .update(workspace)
    .set({
      budgetSyncStatus: input.failed
        ? 'pending'
        : sql`case when ${workspace.budgetSyncRevision} = ${input.revision} then 'idle' else 'pending' end`,
      budgetSyncLease: null,
      budgetSyncLeaseUntil: null,
    })
    .where(
      and(
        eq(workspace.id, input.workspaceId),
        eq(workspace.budgetSyncLease, input.token),
        inArray(workspace.budgetSyncStatus, budgetSyncMachine.sourcesOf('idle')),
      ),
    )
    .returning({ id: workspace.id });
  return moved.length > 0;
}
