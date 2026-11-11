import type Stripe from 'stripe';
import { STRIPE_WEBHOOK_EVENTS } from '../lib/stripe-webhook-events';

export async function stripeWebhookConfigurationErrors(
  stripe: Stripe,
  appUrl: string,
): Promise<string[]> {
  const url = new URL('/api/webhooks/stripe', appUrl).href;
  const errors: string[] = [];
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (endpoint.url !== url || endpoint.status !== 'enabled') continue;
    const missing = STRIPE_WEBHOOK_EVENTS.filter(
      (event) => !endpoint.enabled_events.includes('*') && !endpoint.enabled_events.includes(event),
    );
    if (missing.length === 0) return [];
    errors.push(
      `Stripe webhook ${endpoint.id} at ${url} is missing events: ${missing.join(', ')}.`,
    );
  }
  return errors.length > 0 ? errors : [`No enabled Stripe webhook endpoint matches ${url}.`];
}
