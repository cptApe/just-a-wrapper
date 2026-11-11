import { requireStripe } from '@/lib/stripe';
import 'server-only';
import type { z } from 'zod';
import type { topupOptionsSchema } from '../lib/billing-response';
import { defaultCardPaymentMethod } from './default-card-payment-method';
import { billingTerms } from './plan-limits';
import type { ActiveWorkspace } from './resolve-workspace';

export async function getTopupOptions(
  workspace: ActiveWorkspace,
): Promise<z.infer<typeof topupOptionsSchema>> {
  const terms = await billingTerms();
  // A workspace that can still pick a plan sees that choice beside the one-time purchase.
  const offersPlans =
    terms.kind === 'stripe' && terms.rules.sellsPlans && workspace.stripeSubscriptionId === null;
  const base = { workspaceId: workspace.id, offersPlans };
  if (!workspace.stripeCustomerId) return { ...base, savedCard: null };
  const paymentMethod = await defaultCardPaymentMethod(
    requireStripe(),
    workspace.stripeCustomerId,
    workspace.stripeSubscriptionId,
    'expanded',
  );
  if (!paymentMethod) return { ...base, savedCard: null };
  // The charge path uses any default method, so a non-card default must still read as saved.
  const card = typeof paymentMethod === 'string' ? null : paymentMethod.card;
  return {
    ...base,
    savedCard: { brand: card?.brand ?? null, last4: card?.last4 ?? null },
  };
}
