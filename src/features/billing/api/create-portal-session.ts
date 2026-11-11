import 'server-only';
import { env } from '@/lib/env';
import { BillingError, PortalUnavailableError } from '@/lib/errors';
import { requireStripe } from '@/lib/stripe';
import type { ActiveWorkspace } from './resolve-workspace';

// Do not create an empty Stripe customer just to open a portal with nothing to manage.
export async function createPortalSession(input: {
  workspace: ActiveWorkspace;
}): Promise<{ url: string }> {
  try {
    const stripe = requireStripe();
    const customerId = input.workspace.stripeCustomerId;
    if (!customerId) {
      throw new BillingError('WORKSPACE_NOT_FOUND', 'workspace has no Stripe customer to manage', {
        workspaceId: input.workspace.id,
      });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${env.NEXT_PUBLIC_APP_URL}/app/settings/billing?portal=returned`,
    });
    return { url: portal.url };
  } catch (cause) {
    throw new PortalUnavailableError(input.workspace.id, cause);
  }
}
