// Source references are the idempotency keys of purchase grants. The credit_grant unique index on
// (workspace, source reference) is the only guard against granting one payment twice.

/** A top-up is keyed by its payment intent, shared by Checkout and the intent webhooks. */
export function topupGrantRef(paymentIntentId: string): string {
  return `stripe:${paymentIntentId}`;
}

/** A plan invoice grants one bucket per delivered month. */
export function invoiceGrantRef(invoiceId: string, month: number): string {
  return `${invoiceGrantRefPrefix(invoiceId)}${month}`;
}

export function invoiceGrantRefPrefix(invoiceId: string): string {
  return `plan-invoice:${invoiceId}:`;
}
