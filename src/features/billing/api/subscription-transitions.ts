import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { workspace, workspaceNotDeleted } from '@/db/schema';
import { BillingError } from '@/lib/errors';
import type { BillingTx } from './credit-ledger';
import type { Grant } from './resolve-invoice-grant';

export async function applyPlanEntitlement(
  tx: BillingTx,
  input: {
    workspaceId: string;
    subscriptionId: string;
    grant: Grant;
    resetAt: Date | null;
  },
): Promise<boolean> {
  const moved = await tx
    .update(workspace)
    .set({
      stripeSubscriptionId: input.subscriptionId,
      planTier: input.grant.tier,
      planBillingInterval: input.grant.interval,
      planCredits: input.grant.credits,
      ...(input.resetAt === null ? {} : { creditResetAt: input.resetAt }),
      billingRevision: sql`${workspace.billingRevision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workspace.id, input.workspaceId),
        workspaceNotDeleted,
        or(
          isNull(workspace.stripeSubscriptionId),
          eq(workspace.stripeSubscriptionId, input.subscriptionId),
        ),
      ),
    )
    .returning({ id: workspace.id });
  return moved.length > 0;
}

export async function endPlanEntitlement(
  tx: BillingTx,
  workspaceId: string,
  subscriptionId: string,
): Promise<boolean> {
  const moved = await tx
    .update(workspace)
    .set({
      stripeSubscriptionId: null,
      planTier: 'none',
      planBillingInterval: null,
      planCredits: null,
      creditResetAt: null,
      autoTopupEnabled: false,
      billingRevision: sql`${workspace.billingRevision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workspace.id, workspaceId),
        workspaceNotDeleted,
        eq(workspace.stripeSubscriptionId, subscriptionId),
      ),
    )
    .returning({ id: workspace.id });
  return moved.length > 0;
}

export async function cancelBillingSubscription(
  stripe: Stripe,
  subscription: Pick<Stripe.Subscription, 'id' | 'status'>,
  reason: 'deleted-workspace' | 'duplicate-subscription',
): Promise<void> {
  if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') return;
  try {
    await stripe.subscriptions.cancel(
      subscription.id,
      {},
      {
        idempotencyKey: `cancel-${reason}:${subscription.id}`,
      },
    );
  } catch (cause) {
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not cancel billing subscription',
      {
        subscriptionId: subscription.id,
        reason,
      },
      { cause },
    );
  }
}

// Deletion must close abandoned Checkouts as well as subscriptions that never bound locally.
export async function stopDeletedWorkspaceBilling(
  stripe: Stripe,
  customerId: string,
): Promise<void> {
  try {
    for await (const checkout of stripe.checkout.sessions.list({
      customer: customerId,
      status: 'open',
      limit: 100,
    })) {
      await stripe.checkout.sessions.expire(checkout.id);
    }
    for await (const subscription of stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      limit: 100,
    })) {
      await cancelBillingSubscription(stripe, subscription, 'deleted-workspace');
    }
  } catch (cause) {
    // A missing customer has no remaining Checkouts or subscriptions to close.
    if (cause instanceof Error && 'code' in cause && cause.code === 'resource_missing') return;
    if (cause instanceof BillingError) throw cause;
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not stop deleted workspace billing',
      { customerId },
      { cause },
    );
  }
}
