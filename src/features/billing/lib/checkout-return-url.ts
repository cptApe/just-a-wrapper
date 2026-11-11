const CHECKOUT_SESSION_ID = '{CHECKOUT_SESSION_ID}';

export function buildCheckoutSuccessUrl(appUrl: string, kind: 'plan' | 'topup'): string {
  const billingUrl = new URL('/app/settings/billing', appUrl).toString();
  const topup = kind === 'topup' ? '&topup=success' : '';
  return `${billingUrl}?checkout=success${topup}&session_id=${CHECKOUT_SESSION_ID}`;
}
