import type Stripe from 'stripe';
import { BillingError } from '@/lib/errors';
import { captureException } from '@/lib/observability';
import { idOfExpandable } from './retrieve-current-subscription';

// Stripe idempotency keys expire; the intent's charge also proves a refund on later webhook retries.
export async function refundDeletedWorkspacePayment(
  stripe: Stripe,
  paymentIntentId: string,
): Promise<void> {
  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ['latest_charge'],
    });
    const charge = intent.latest_charge;
    if (charge && typeof charge !== 'string' && charge.refunded) return;
    await stripe.refunds.create(
      { payment_intent: paymentIntentId },
      {
        idempotencyKey: `refund-deleted-workspace:${paymentIntentId}`,
      },
    );
  } catch (cause) {
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not refund deleted workspace payment',
      { paymentIntentId },
      { cause },
    );
  }
}

export async function refundDeletedWorkspaceInvoice(
  stripe: Stripe,
  invoiceId: string,
): Promise<void> {
  try {
    for await (const payment of stripe.invoicePayments.list({
      invoice: invoiceId,
      status: 'paid',
      limit: 100,
    })) {
      const intentId = idOfExpandable(payment.payment.payment_intent ?? null);
      if (!intentId) {
        captureException(
          new BillingError('EXTERNAL_API_FAILED', 'Paid invoice has no refundable payment intent', {
            invoiceId,
            paymentId: payment.id,
            defect: 'invoice-payment-not-refundable',
          }),
        );
        continue;
      }
      await refundDeletedWorkspacePayment(stripe, intentId);
    }
  } catch (cause) {
    if (cause instanceof BillingError) throw cause;
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not refund deleted workspace invoice',
      { invoiceId },
      { cause },
    );
  }
}
