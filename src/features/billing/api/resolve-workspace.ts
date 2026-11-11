import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspace } from '@/db/schema';
import { type Caller, resolveCaller } from '@/lib/caller';
import { BillingError } from '@/lib/errors';
import { requireStripe } from '@/lib/stripe';
import { getLiveCreditBalance } from './credit-ledger';
import 'server-only';
import type { BillingInterval, WorkspacePlan } from '../pricing-config';

export type ActiveWorkspace = {
  id: string;
  organizationId: string;
  name: string;
  creditBalance: number;
  creditResetAt: Date | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  planTier: WorkspacePlan;
  planBillingInterval: BillingInterval | null;
  planCredits: number | null;
  autoTopupEnabled: boolean;
  autoTopupThresholdCredits: number;
  autoTopupCredits: number;
  autoTopupMonthlyCapCents: number;
  userEmail: string;
  userId: string;
};

// The caller already proved live membership; this only reads the workspace's billing columns.
export async function loadBillingWorkspace(caller: Caller): Promise<ActiveWorkspace> {
  const row = (
    await db.select().from(workspace).where(eq(workspace.id, caller.workspaceId)).limit(1)
  ).at(0);
  if (!row) {
    throw new BillingError('WORKSPACE_NOT_FOUND', 'no workspace row for caller', {
      workspaceId: caller.workspaceId,
    });
  }
  return {
    id: row.id,
    organizationId: caller.organizationId,
    name: row.name,
    creditBalance: await getLiveCreditBalance(row.id),
    creditResetAt: row.creditResetAt,
    stripeCustomerId: row.stripeCustomerId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    planTier: row.planTier,
    planBillingInterval: row.planBillingInterval,
    planCredits: row.planCredits,
    autoTopupEnabled: row.autoTopupEnabled,
    autoTopupThresholdCredits: row.autoTopupThresholdCredits,
    autoTopupCredits: row.autoTopupCredits,
    autoTopupMonthlyCapCents: row.autoTopupMonthlyCapCents,
    userEmail: caller.email,
    userId: caller.userId,
  };
}

/** Member-level entry: any live member of the workspace. */
export async function resolveActiveWorkspace(headers: Headers): Promise<ActiveWorkspace> {
  return loadBillingWorkspace(await resolveCaller(headers));
}

export async function requireBillingAdmin(headers: Headers): Promise<ActiveWorkspace> {
  requireStripe();
  const caller = await resolveCaller(headers, {
    atLeast: 'admin',
    refusal: 'Billing administration requires owner or admin',
  });
  return loadBillingWorkspace(caller);
}
