import { stripeWebhookConfigurationErrors } from '@/features/billing/api/stripe-webhook-configuration';
import { env } from '@/lib/env';
import { captureException } from '@/lib/observability';
import { getStripe } from '@/lib/stripe';
import 'server-only';
import { eq, max } from 'drizzle-orm';
import { db } from '@/db';
import { processedWebhookEvent } from '@/db/schema';

export type StripeWebhookStatus = ({ kind: 'received'; at: Date } | { kind: 'never' }) & {
  configurationErrors: string[];
};

export async function getStripeWebhookStatus(): Promise<StripeWebhookStatus> {
  const row = (
    await db
      .select({ at: max(processedWebhookEvent.processedAt) })
      .from(processedWebhookEvent)
      // Every Stripe row is a delivery receipt.
      .where(eq(processedWebhookEvent.provider, 'stripe'))
  ).at(0);
  const stripe = getStripe();
  let configurationErrors: string[] = [];
  if (stripe) {
    try {
      configurationErrors = await stripeWebhookConfigurationErrors(stripe, env.NEXT_PUBLIC_APP_URL);
    } catch (error) {
      // Configuration diagnostics remain readable while Stripe is unavailable or access is restricted.
      captureException(error, { feature: 'admin', op: 'stripe-webhook-status' });
      configurationErrors = [
        'Could not inspect Stripe webhook configuration. Check Stripe access and availability.',
      ];
    }
  }
  return row?.at
    ? { kind: 'received', at: row.at, configurationErrors }
    : { kind: 'never', configurationErrors };
}
