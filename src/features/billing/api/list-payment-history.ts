import { requireStripe } from '@/lib/stripe';
import 'server-only';
import type Stripe from 'stripe';
import { formatCount } from '@/lib/format/format-number';
import type { ActiveWorkspace } from './resolve-workspace';

export type PaymentHistoryEntry = {
  id: string;
  date: Date;
  description: string;
  amountCents: number;
  currency: string;
  receiptUrl: string | null;
};

const HISTORY_FETCH_LIMIT = 50;

// Charges cover both subscription and top-up receipts. Only settled payments belong in history.
// Expand intent metadata to distinguish top-ups because the pinned Charge shape has no invoice reference.
export async function listPaymentHistory(
  workspace: ActiveWorkspace,
): Promise<PaymentHistoryEntry[]> {
  const stripe = requireStripe();

  if (!workspace.stripeCustomerId) {
    return [];
  }

  const charges = await stripe.charges.list({
    customer: workspace.stripeCustomerId,
    limit: HISTORY_FETCH_LIMIT,
    expand: ['data.payment_intent'],
  });

  const entries: PaymentHistoryEntry[] = [];
  for (const charge of charges.data) {
    if (charge.status !== 'succeeded' || !charge.paid) {
      continue;
    }
    entries.push({
      id: charge.id,
      date: new Date(charge.created * 1000),
      description: describeCharge(charge),
      amountCents: charge.amount,
      currency: charge.currency,
      receiptUrl: charge.receipt_url,
    });
  }
  return entries;
}

// Malformed top-up credit metadata still means a top-up, never a subscription payment.
function describeCharge(charge: Stripe.Charge): string {
  const paymentIntent =
    charge.payment_intent && typeof charge.payment_intent === 'object'
      ? charge.payment_intent
      : null;
  const meta = paymentIntent?.metadata;
  if (meta?.kind === 'topup') {
    const credits = meta.credits ? Number.parseInt(meta.credits, 10) : Number.NaN;
    return Number.isFinite(credits) && credits > 0
      ? `Top up ${formatCount(credits)} credits`
      : 'Top up';
  }
  return 'Plan payment';
}
