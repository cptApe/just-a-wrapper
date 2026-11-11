import type Stripe from 'stripe';

export const STRIPE_WEBHOOK_EVENTS = [
  'charge.refunded',
  'refund.updated',
  'refund.failed',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
  'customer.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'checkout.session.completed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'customer.subscription.deleted',
  'customer.subscription.updated',
] as const satisfies readonly Stripe.Event.Type[];
