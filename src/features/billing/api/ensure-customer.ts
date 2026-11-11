import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { workspaceNotDeleted, workspace as workspaceTable } from '@/db/schema';
import { BillingError } from '@/lib/errors';
import { claimStripeCustomer } from './customer-transitions';
import 'server-only';
import type Stripe from 'stripe';
import type { ActiveWorkspace } from './resolve-workspace';

// Publish the customer mapping before Checkout can emit webhooks.
// Stripe idempotency and database compare-and-set make concurrent first purchases resolve to one customer.
export async function ensureCustomer(stripe: Stripe, workspace: ActiveWorkspace): Promise<string> {
  const current = (
    await db
      .select({
        customerId: workspaceTable.stripeCustomerId,
        generation: workspaceTable.stripeCustomerGeneration,
      })
      .from(workspaceTable)
      .where(and(eq(workspaceTable.id, workspace.id), workspaceNotDeleted))
  ).at(0);
  if (!current)
    throw new BillingError('WORKSPACE_NOT_FOUND', 'No workspace for Stripe customer', {
      workspaceId: workspace.id,
    });
  if (current.customerId) return current.customerId;

  const customer = await stripe.customers.create(
    {
      email: workspace.userEmail,
      name: workspace.name,
      metadata: { workspace_id: workspace.id, organization_id: workspace.organizationId },
    },
    { idempotencyKey: `billing-customer:${workspace.id}:${current.generation}` },
  );
  const claimed = await claimStripeCustomer({
    workspaceId: workspace.id,
    customerId: customer.id,
    generation: current.generation,
  });
  if (claimed) return customer.id;

  const winner = (
    await db
      .select({ stripeCustomerId: workspaceTable.stripeCustomerId })
      .from(workspaceTable)
      .where(eq(workspaceTable.id, workspace.id))
      .limit(1)
  ).at(0);
  if (!winner) {
    throw new BillingError('WORKSPACE_NOT_FOUND', 'no workspace for Stripe customer', {
      workspaceId: workspace.id,
    });
  }
  if (!winner.stripeCustomerId) {
    throw new BillingError('UNEXPECTED', 'Stripe customer compare-and-set did not persist', {
      workspaceId: workspace.id,
      customerId: customer.id,
    });
  }
  return winner.stripeCustomerId;
}
