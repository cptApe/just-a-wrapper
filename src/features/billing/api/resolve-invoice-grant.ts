import { BillingError } from '@/lib/errors';
import 'server-only';
import type Stripe from 'stripe';
import { creditsForPaidCents } from '../lib/webhook-credit-split';
import { type BillingInterval, isPlanTier, type PlanTier } from '../pricing-config';

type PlanFromPrice = {
  credits: number;
  tier: PlanTier;
  interval: BillingInterval;
  period: Stripe.InvoiceLineItem.Period;
};

export type Grant = PlanFromPrice & {
  customerId: string;
  subscriptionId: string | null;
};

export async function resolveGrant(stripe: Stripe, invoice: Stripe.Invoice): Promise<Grant | null> {
  if (!subscriptionIdFromInvoice(invoice)) return null;
  const customerId =
    typeof invoice.customer === 'string' ? invoice.customer : (invoice.customer?.id ?? null);
  if (!customerId) {
    throw new BillingError('EXTERNAL_API_FAILED', 'invoice.paid has no customer', {
      invoiceId: invoice.id,
    });
  }
  const plan = await planFromInvoice(stripe, invoice);
  if (!plan) return null;
  return {
    customerId,
    subscriptionId: subscriptionIdFromInvoice(invoice),
    ...plan,
  };
}

// A cycle invoice always grants; a mid-cycle change grants only when its paid amount buys a credit.
export function invoiceExpectsGrant(
  invoice: Pick<Stripe.Invoice, 'billing_reason' | 'amount_paid'>,
  grant: Grant | null,
): boolean {
  if (!grant) return false;
  if (invoice.billing_reason !== 'subscription_update') return true;
  return creditsForPaidCents(invoice.amount_paid, grant.interval) > 0;
}

// The pinned Stripe API stores the subscription under invoice.parent.subscription_details.
function subscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  if (!subscription) {
    return null;
  }
  return typeof subscription === 'string' ? subscription : subscription.id;
}

function parsePositiveInt(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : null;
}

// Seeded prices carry a credit multiplier; missing quantities must fail rather than inventing a grant.
function creditsFromPricedLine(
  price: Stripe.Price,
  quantity: number | null,
  context: Record<string, unknown>,
): number | null {
  const blockCredits = parsePositiveInt(price.metadata.block_credits);
  if (blockCredits !== null) {
    if (quantity === null || !Number.isInteger(quantity) || quantity <= 0) {
      throw new BillingError('EXTERNAL_API_FAILED', 'a plan line carries no usable quantity', {
        ...context,
        priceId: price.id,
        quantity,
      });
    }
    return blockCredits * quantity;
  }
  return null;
}

function tierFromPrice(price: Stripe.Price): PlanTier | null {
  const raw = price.metadata.tier;
  return raw && isPlanTier(raw) ? raw : null;
}

function intervalFromPrice(price: Stripe.Price): BillingInterval {
  return price.recurring?.interval === 'year' ? 'year' : 'month';
}

// Ignore negative proration credit lines; the positive price line describes the newly purchased package.
async function planFromInvoice(
  stripe: Stripe,
  invoice: Stripe.Invoice,
): Promise<PlanFromPrice | null> {
  const lines = invoice.lines.has_more
    ? stripe.invoices.listLineItems(invoice.id, { limit: 100 })
    : invoice.lines.data;
  for await (const line of lines) {
    if (line.amount < 0) continue;
    const priceRef = line.pricing?.price_details?.price;
    if (!priceRef) continue;
    const price = typeof priceRef === 'string' ? await stripe.prices.retrieve(priceRef) : priceRef;
    const credits = creditsFromPricedLine(price, line.quantity ?? null, {
      invoiceId: invoice.id,
      lineId: line.id,
    });
    const tier = tierFromPrice(price);
    if (credits !== null && tier !== null) {
      return { credits, tier, interval: intervalFromPrice(price), period: line.period };
    }
  }
  return null;
}
