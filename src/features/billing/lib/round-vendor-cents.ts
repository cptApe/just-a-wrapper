import { BillingError } from '@/lib/errors';

// Match numeric(20, 6) before storing or reporting cost so reconciliation cannot create rows from rounding dust.
export function roundVendorCents(cents: number): number {
  if (!Number.isFinite(cents) || cents < 0) {
    throw new BillingError('VALIDATION_FAILED', 'Invalid vendor cost', { cents });
  }
  return Math.round(cents * 1_000_000) / 1_000_000;
}
