import type Stripe from 'stripe';

// Processing funds may still settle; opening another Checkout would risk charging the customer twice.
export function decideFromIntentStatus(
  status: Stripe.PaymentIntent.Status,
): 'charged' | 'processing' | 'fallback' {
  if (status === 'succeeded') return 'charged';
  if (status === 'processing') return 'processing';
  return 'fallback';
}

export type TopupCardFailureReason = 'declined' | 'authentication_required';

// Off-session charges report a required bank approval as either the error code or the decline code.
export function topupCardFailureReason(error: {
  code?: string;
  decline_code?: string;
}): TopupCardFailureReason {
  return error.code === 'authentication_required' ||
    error.decline_code === 'authentication_required'
    ? 'authentication_required'
    : 'declined';
}
