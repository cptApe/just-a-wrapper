import { retireCreditGrants } from './credit-grant-transitions';
// Ending a plan retires its grants and disables auto top-up; purchased credits survive.

import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { creditGrant, workspace, workspaceNotDeleted } from '@/db/schema';
import { captureEvent } from '@/lib/analytics';
import { BillingError } from '@/lib/errors';
import { workspaceOwnerUserId } from '@/lib/workspace-identity';
import 'server-only';
import type Stripe from 'stripe';
import { retireFuturePlanGrants } from './credit-ledger';
import { type LockedLedger, lockLedgerWhere } from './ledger-lock';
import { retrieveCurrentSubscription, subscriptionHasEnded } from './retrieve-current-subscription';
import { endPlanEntitlement } from './subscription-transitions';
import { type WebhookResult } from './webhook-result';

export async function handleSubscriptionEnded(
  event: Stripe.CustomerSubscriptionDeletedEvent | Stripe.CustomerSubscriptionUpdatedEvent,
  stripe: Stripe,
): Promise<WebhookResult> {
  const subscription = event.data.object;
  const observed = (
    await db
      .select({ billingRevision: workspace.billingRevision })
      .from(workspace)
      .where(and(eq(workspace.stripeSubscriptionId, subscription.id), workspaceNotDeleted))
  ).at(0);
  if (!observed) return { status: 200, body: { received: true, unmapped: true } };
  const currentSubscription = await retrieveCurrentSubscription(stripe, subscription.id, event.id);
  if (!subscriptionHasEnded(currentSubscription))
    return { status: 200, body: { received: true, stale: true } };
  const result = await db.transaction(async (tx) => {
    const locked = await lockLedgerWhere(
      tx,
      tx
        .select({
          id: workspace.id,
          billingRevision: workspace.billingRevision,
        })
        .from(workspace)
        .where(and(eq(workspace.stripeSubscriptionId, subscription.id), workspaceNotDeleted)),
      'update',
    );
    // Ending clears the subscription id, so a redelivery finds no workspace to lock.
    if (!locked) return { idempotent: true as const, workspaceId: null };
    const { row: workspaceRow, ledger } = locked;
    if (workspaceRow.billingRevision !== observed.billingRevision)
      throw new BillingError(
        'CONFLICT',
        'Subscription changed while Stripe was being read; retry cancellation',
        { workspaceId: workspaceRow.id },
      );
    const moved = await endPlanEntitlement(tx, workspaceRow.id, subscription.id);
    if (!moved)
      throw new BillingError('CONFLICT', 'Subscription end lost its workspace guard', {
        workspaceId: workspaceRow.id,
      });
    await retireSubscriptionCredits(ledger);
    return { idempotent: false as const, stale: false as const, workspaceId: workspaceRow.id };
  });
  if (!result.idempotent) {
    const ownerUserId = await workspaceOwnerUserId(result.workspaceId);
    captureEvent(
      'billing:plan_cancel',
      { stripe_event_type: event.type },
      { userId: ownerUserId, workspaceId: result.workspaceId },
    );
  }
  return { status: 200, body: { received: true, ...result } };
}

async function retireSubscriptionCredits(ledger: LockedLedger) {
  await retireFuturePlanGrants(ledger);
  await retireCreditGrants(ledger, eq(creditGrant.source, 'plan'));
}
