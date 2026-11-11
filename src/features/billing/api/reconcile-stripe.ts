import { AuthorizationError, BillingError } from '@/lib/errors';
import { requireStripe } from '@/lib/stripe';
import 'server-only';
import type Stripe from 'stripe';
import { handleCheckoutCompleted } from './handle-checkout-completed';
import { handleInvoicePaid } from './handle-invoice-paid';
import type { ActiveWorkspace } from './resolve-workspace';
import { idOfExpandable, subscriptionHasEnded } from './retrieve-current-subscription';
import { type WebhookResult } from './webhook-result';

export type ReconcileStripeResult =
  | { kind: 'applied' | 'unchanged'; result: WebhookResult }
  | { kind: 'pending' | 'no_customer' | 'no_subscription' | 'no_invoice' };

function assertCheckoutOwner(checkout: Stripe.Checkout.Session, workspace: ActiveWorkspace): void {
  const customerId = idOfExpandable(checkout.customer);
  if (!workspace.stripeCustomerId || workspace.stripeCustomerId !== customerId) {
    throw new AuthorizationError('Checkout belongs to a different workspace', {
      workspaceId: workspace.id,
      checkoutSessionId: checkout.id,
    });
  }
}

async function stripeRead<T>(
  operation: string,
  context: Record<string, unknown>,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (cause) {
    throw new BillingError('EXTERNAL_API_FAILED', `Could not ${operation} from Stripe`, context, {
      cause,
    });
  }
}

async function applySubscriptionInvoice(input: {
  stripe: Stripe;
  workspace: ActiveWorkspace;
  subscription: Stripe.Subscription;
}): Promise<ReconcileStripeResult> {
  const invoiceId = idOfExpandable(input.subscription.latest_invoice);
  if (!invoiceId) return { kind: 'no_invoice' };
  const invoice = await stripeRead('read the paid invoice', { invoiceId }, () =>
    input.stripe.invoices.retrieve(invoiceId),
  );
  const invoiceCustomerId = idOfExpandable(invoice.customer);
  if (invoiceCustomerId !== input.workspace.stripeCustomerId) {
    throw new AuthorizationError('Stripe invoice belongs to a different workspace', {
      workspaceId: input.workspace.id,
      invoiceId,
    });
  }
  if (invoice.status !== 'paid') return { kind: 'pending' };

  // The invoice's grant source references make this safe to run beside the webhook.
  const result = await handleInvoicePaid(input.stripe, invoice);
  if (result.body.unmapped === true || result.body.ignored === 'no-workspace')
    return { kind: 'no_subscription' };
  if (result.body.ignored === 'not-plan-invoice') return { kind: 'no_invoice' };
  return { kind: result.body.idempotent === true ? 'unchanged' : 'applied', result };
}

export async function reconcileCheckoutSession(input: {
  workspace: ActiveWorkspace;
  checkoutSessionId: string;
}): Promise<ReconcileStripeResult> {
  const stripe = requireStripe();
  const checkout = await stripeRead(
    'read the Checkout Session',
    { checkoutSessionId: input.checkoutSessionId },
    () => stripe.checkout.sessions.retrieve(input.checkoutSessionId),
  );
  assertCheckoutOwner(checkout, input.workspace);

  if (checkout.mode === 'payment') {
    if (checkout.payment_status !== 'paid') return { kind: 'pending' };
    const result = await handleCheckoutCompleted(checkout);
    return { kind: result.body.applied === false ? 'unchanged' : 'applied', result };
  }

  const subscriptionId = idOfExpandable(checkout.subscription);
  if (!subscriptionId) return { kind: 'no_subscription' };
  const subscription = await stripeRead('read the subscription', { subscriptionId }, () =>
    stripe.subscriptions.retrieve(subscriptionId),
  );
  return applySubscriptionInvoice({ stripe, workspace: input.workspace, subscription });
}

async function readCurrentSubscription(workspace: ActiveWorkspace): Promise<ReconcileStripeResult> {
  const stripe = requireStripe();
  if (!workspace.stripeCustomerId) return { kind: 'no_customer' };
  const customerId = workspace.stripeCustomerId;

  const subscriptions = await stripeRead(
    'read the customer subscriptions',
    { customerId },
    async () => {
      const response = await stripe.subscriptions.list({ customer: customerId, status: 'all' });
      return response.data;
    },
  );
  const subscription = subscriptions
    .filter((candidate) => !subscriptionHasEnded(candidate))
    .sort((a, b) => b.created - a.created)
    .at(0);
  if (!subscription) return { kind: 'no_subscription' };

  return applySubscriptionInvoice({ stripe, workspace, subscription });
}

// Open automatic top-ups are finished by their webhook and the billing cron, not by this read.
export function reconcileCurrentSubscription(
  workspace: ActiveWorkspace,
): Promise<ReconcileStripeResult> {
  return readCurrentSubscription(workspace);
}
