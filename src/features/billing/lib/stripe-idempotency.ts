// Stripe keeps an idempotency key for at least 24 hours. Before this age a repeated create with the
// same key replays the first answer; after it, only looking the payment up is safe.
export const STRIPE_IDEMPOTENCY_SAFE_HOURS = 23;
