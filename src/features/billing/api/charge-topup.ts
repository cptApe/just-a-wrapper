import { BillingError } from '@/lib/errors';
import { requireStripe } from '@/lib/stripe';
import 'server-only';
import Stripe from 'stripe';
import type { z } from 'zod';
import { topupChargeSchema } from '../lib/billing-response';
import {
  decideFromIntentStatus,
  type TopupCardFailureReason,
  topupCardFailureReason,
} from '../lib/topup-charge-decision';
import { BILLING_CURRENCY, topupAmountCents } from '../pricing-config';
import { createTopupCheckoutSession } from './create-topup-checkout-session';
import { defaultCardPaymentMethod } from './default-card-payment-method';
import { grantTopupAndResume } from './grant-topup';
import {
  type ManualTopupAttempt,
  moveManualTopupAttempt,
  openManualTopupAttempt,
} from './manual-topup-transitions';
import { reconcileManualTopup } from './reconcile-manual-topup';
import type { ActiveWorkspace } from './resolve-workspace';

export type TopupChargeResult = z.infer<typeof topupChargeSchema>;

type TopupPack = { credits: number; unitAmount: number; currency: string };

// Charge the default off-session, so no bank screen can appear. Only a workspace with no saved card goes to Checkout.
// A decline or an authentication demand cancels the intent and reports why. Processing waits for its webhook.
// The server's own attempt row decides whether a new charge is safe; the browser sends only the key.
export async function chargeTopup(input: {
  workspace: ActiveWorkspace;
  credits: number;
  idempotencyKey: string;
}): Promise<TopupChargeResult> {
  const stripe = requireStripe();
  const attemptRef = { workspaceId: input.workspace.id, attemptKey: input.idempotencyKey };
  const attempt = await openManualTopupAttempt({ ...attemptRef, credits: input.credits });
  if (attempt.status === 'succeeded') return { outcome: 'already_charged' };
  if (attempt.status === 'expired') return { outcome: 'expired' };
  try {
    const result = await chargeAttempt(stripe, input, attempt);
    await recordOutcome(attemptRef, result);
    return result.outcome;
  } catch (cause) {
    if (cause instanceof BillingError) throw cause;
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'Could not complete top-up purchase',
      { attempt: input.idempotencyKey, credits: input.credits },
      { cause },
    );
  }
}

type AttemptResult = { outcome: TopupChargeResult; paymentIntentId: string | null };

async function chargeAttempt(
  stripe: Stripe,
  input: { workspace: ActiveWorkspace; credits: number; idempotencyKey: string },
  attempt: ManualTopupAttempt,
): Promise<AttemptResult> {
  const pack = {
    credits: input.credits,
    unitAmount: topupAmountCents(input.credits),
    currency: BILLING_CURRENCY,
  };
  // Checkout establishes the customer mapping when the workspace has never paid.
  const customerId = input.workspace.stripeCustomerId;
  if (attempt.pastIdempotencyWindow) {
    if (!customerId) return { outcome: { outcome: 'expired' }, paymentIntentId: null };
    return {
      outcome: await reconcileManualTopup(stripe, {
        customerId,
        idempotencyKey: input.idempotencyKey,
        createdAt: attempt.createdAt,
      }),
      paymentIntentId: null,
    };
  }
  const checkout = async (): Promise<AttemptResult> => ({
    outcome: await fallbackToCheckout(input.workspace, pack, input.idempotencyKey),
    paymentIntentId: null,
  });
  if (!customerId) return checkout();
  const paymentMethod = await defaultCardPaymentMethod(
    stripe,
    customerId,
    input.workspace.stripeSubscriptionId,
    'id',
  );
  const paymentMethodId = typeof paymentMethod === 'string' ? paymentMethod : paymentMethod?.id;
  if (!paymentMethodId) return checkout();
  const charge = await chargeDefaultPaymentMethod(stripe, {
    workspace: input.workspace,
    pack,
    customerId,
    paymentMethodId,
    idempotencyKey: input.idempotencyKey,
  });
  if (charge.kind === 'card_failed')
    return { outcome: { outcome: 'card_failed', reason: charge.reason }, paymentIntentId: null };
  const intent =
    decideFromIntentStatus(charge.intent.status) === 'fallback' &&
    charge.intent.status !== 'canceled'
      ? await stripe.paymentIntents.retrieve(charge.intent.id)
      : charge.intent;
  const decision = decideFromIntentStatus(intent.status);
  if (decision === 'fallback') {
    if (intent.status !== 'canceled') await stripe.paymentIntents.cancel(intent.id);
    return {
      outcome: {
        outcome: 'card_failed',
        reason: intent.status === 'requires_action' ? 'authentication_required' : 'declined',
      },
      paymentIntentId: intent.id,
    };
  }
  if (decision === 'processing')
    return { outcome: { outcome: 'processing' }, paymentIntentId: intent.id };
  const grant = await grantTopupAndResume(intent.id, { customerId, credits: pack.credits });
  if (grant.kind === 'refunded')
    throw new BillingError(
      'WORKSPACE_NOT_FOUND',
      'The paying workspace is gone; the charge was refunded',
      {
        workspaceId: input.workspace.id,
        paymentIntentId: intent.id,
      },
    );
  if (charge.replayed)
    return { outcome: { outcome: 'already_charged' }, paymentIntentId: intent.id };
  return {
    outcome: { outcome: 'charged', credits: pack.credits, balance: grant.balance },
    paymentIntentId: intent.id,
  };
}

// The attempt row follows what Stripe answered; an open Checkout leaves it open.
async function recordOutcome(
  attemptRef: { workspaceId: string; attemptKey: string },
  result: AttemptResult,
): Promise<void> {
  const status = attemptStatusAfter(result);
  if (status === null) return;
  await moveManualTopupAttempt({ ...attemptRef, status, paymentIntentId: result.paymentIntentId });
}

function attemptStatusAfter(result: AttemptResult) {
  switch (result.outcome.outcome) {
    case 'charged':
    case 'already_charged':
      return 'succeeded' as const;
    case 'processing':
      return result.paymentIntentId === null ? null : ('processing' as const);
    case 'card_failed':
      return 'failed' as const;
    case 'expired':
      return 'expired' as const;
    case 'fallback':
      return null;
  }
}

async function chargeDefaultPaymentMethod(
  stripe: Stripe,
  input: {
    workspace: ActiveWorkspace;
    pack: TopupPack;
    customerId: string;
    paymentMethodId: string;
    idempotencyKey: string;
  },
): Promise<
  | { kind: 'intent'; intent: Stripe.PaymentIntent; replayed: boolean }
  | { kind: 'card_failed'; reason: TopupCardFailureReason }
> {
  try {
    // The attempt key prevents duplicate charges; the intent ID separately prevents duplicate grants.
    // Confirming off-session can throw authentication_required because no customer is present to complete a challenge.
    const intent = await stripe.paymentIntents.create(
      {
        amount: input.pack.unitAmount,
        currency: input.pack.currency,
        customer: input.customerId,
        payment_method: input.paymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          kind: 'topup',
          manual_attempt_key: input.idempotencyKey,
          workspace_id: input.workspace.id,
          organization_id: input.workspace.organizationId,
          credits: String(input.pack.credits),
        },
      },
      { idempotencyKey: `topup:${input.workspace.id}:${input.idempotencyKey}` },
    );
    return {
      kind: 'intent',
      intent,
      replayed: intent.lastResponse.headers['idempotent-replayed'] === 'true',
    };
  } catch (cause) {
    if (cause instanceof Stripe.errors.StripeCardError) {
      const paymentIntent = cause.payment_intent;
      if (paymentIntent) {
        const current = await stripe.paymentIntents.retrieve(paymentIntent.id);
        if (current.status === 'succeeded' || current.status === 'processing')
          return { kind: 'intent', intent: current, replayed: false };
        if (current.status !== 'canceled') await stripe.paymentIntents.cancel(current.id);
      }
      return { kind: 'card_failed', reason: topupCardFailureReason(cause) };
    }
    throw new BillingError(
      'EXTERNAL_API_FAILED',
      'off-session top-up charge failed',
      { customerId: input.customerId, credits: input.pack.credits },
      { cause },
    );
  }
}

async function fallbackToCheckout(
  workspace: ActiveWorkspace,
  pack: TopupPack,
  idempotencyKey: string,
): Promise<TopupChargeResult> {
  return createTopupCheckoutSession({
    workspace,
    credits: pack.credits,
    idempotencyKey,
  });
}
