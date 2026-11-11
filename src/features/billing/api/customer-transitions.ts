import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/db';
import { creditGrant, workspace, workspaceNotDeleted } from '@/db/schema';
import { retireCreditGrants } from './credit-grant-transitions';
import { retireFuturePlanGrants } from './credit-ledger';
import { lockLedgerWhere } from './ledger-lock';
import { endPlanEntitlement } from './subscription-transitions';

export async function claimStripeCustomer(input: {
  workspaceId: string;
  customerId: string;
  generation: number;
}): Promise<boolean> {
  const moved = await db
    .update(workspace)
    .set({
      stripeCustomerId: input.customerId,
      billingRevision: sql`${workspace.billingRevision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workspace.id, input.workspaceId),
        eq(workspace.stripeCustomerGeneration, input.generation),
        workspaceNotDeleted,
        isNull(workspace.stripeCustomerId),
      ),
    )
    .returning({ id: workspace.id });
  return moved.length > 0;
}

export async function deleteStripeCustomer(customerId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const locked = await lockLedgerWhere(
      tx,
      tx.select().from(workspace).where(eq(workspace.stripeCustomerId, customerId)),
      'update',
    );
    if (!locked) return;
    const { row: target, ledger } = locked;
    if (target.stripeSubscriptionId) {
      const moved = await endPlanEntitlement(tx, target.id, target.stripeSubscriptionId);
      if (!moved) return;
      await retireFuturePlanGrants(ledger);
      await retireCreditGrants(ledger, eq(creditGrant.source, 'plan'));
    }
    await tx
      .update(workspace)
      .set({
        stripeCustomerId: null,
        stripeCustomerGeneration: sql`${workspace.stripeCustomerGeneration} + 1`,
        billingRevision: sql`${workspace.billingRevision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(workspace.stripeCustomerId, customerId));
  });
}
