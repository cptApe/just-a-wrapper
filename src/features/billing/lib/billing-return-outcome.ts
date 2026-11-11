import type { z } from 'zod';
import type { stripeReconciliationSchema } from './billing-response';

export type BillingReturnOutcome =
  | z.infer<typeof stripeReconciliationSchema>['status']
  | 'failed'
  | 'cancelled'
  | 'unavailable';
export type BillingReturnSource = 'topup' | 'checkout' | 'portal';

export function billingReturnTone(
  outcome: BillingReturnOutcome,
): 'success' | 'info' | 'warning' | 'error' {
  switch (outcome) {
    case 'applied':
      return 'success';
    case 'unchanged':
    case 'pending':
    case 'cancelled':
      return 'info';
    case 'no_customer':
    case 'no_subscription':
    case 'no_invoice':
    case 'unavailable':
      return 'warning';
    case 'failed':
      return 'error';
  }
}

export function billingReturnMessage(
  outcome: BillingReturnOutcome,
  source: BillingReturnSource,
): string {
  switch (outcome) {
    case 'applied':
      if (source === 'topup') return 'Credits added.';
      return source === 'checkout' ? 'You are on your new plan.' : 'Billing refreshed.';
    case 'unchanged':
      return 'Billing is already up to date.';
    case 'pending':
      return 'Stripe is still finishing your payment.';
    case 'no_customer':
    case 'no_subscription':
      return 'No Stripe subscription found for this workspace.';
    case 'no_invoice':
      return 'No paid invoice was found for this subscription.';
    case 'failed':
      return 'We could not refresh this purchase.';
    case 'cancelled':
      return source === 'topup'
        ? 'Top-up cancelled. Your balance is unchanged.'
        : 'Purchase cancelled. Your balance is unchanged.';
    case 'unavailable':
      return 'The billing portal isn’t available yet. Buy credits first.';
  }
}
