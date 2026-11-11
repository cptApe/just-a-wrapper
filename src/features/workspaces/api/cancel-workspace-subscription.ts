import { cancelBillingSubscription, stopDeletedWorkspaceBilling } from '@/features/billing';
import { AppError } from '@/lib/errors';
import { requireStripe } from '@/lib/stripe';

export async function cancelWorkspaceSubscription(input: {
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
}): Promise<void> {
  if (input.stripeSubscriptionId === null && input.stripeCustomerId === null) return;
  const stripe = requireStripe();
  if (input.stripeCustomerId !== null) {
    await stopDeletedWorkspaceBilling(stripe, input.stripeCustomerId);
    return;
  }
  if (input.stripeSubscriptionId === null) return;
  try {
    const subscription = await stripe.subscriptions.retrieve(
      input.stripeSubscriptionId,
      {},
      { timeout: 10_000, maxNetworkRetries: 0 },
    );
    await cancelBillingSubscription(stripe, subscription, 'deleted-workspace');
  } catch (cause) {
    // Stripe already removed the subscription, so deletion has no billing work left.
    if (cause instanceof Error && 'code' in cause && cause.code === 'resource_missing') return;
    throw new AppError('EXTERNAL_API_FAILED', 'Workspace subscription cancellation failed', input, {
      cause,
    });
  }
}
