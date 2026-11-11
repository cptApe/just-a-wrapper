import {
  type BillingInterval,
  blockUnitAmountCents,
  CREDIT_BLOCK,
  YEARLY_DELIVERED_MONTHS,
} from '../pricing-config';

export function creditsDeliveredPerBlock(interval: BillingInterval): number {
  return interval === 'year' ? CREDIT_BLOCK * YEARLY_DELIVERED_MONTHS : CREDIT_BLOCK;
}

// Multiply integer paid cents before dividing to avoid rounding fractional credit rates into money.
export function creditsForPaidCents(
  paidCents: number | null | undefined,
  interval: BillingInterval,
): number {
  if (typeof paidCents !== 'number' || !Number.isFinite(paidCents) || paidCents <= 0) return 0;
  const cents = Math.floor(paidCents);
  return Math.floor((cents * creditsDeliveredPerBlock(interval)) / blockUnitAmountCents(interval));
}

// Put integer remainders in the earliest months; the total must equal the credits actually paid for.
export function splitCreditsAcrossMonths(totalCredits: number, months: number): number[] {
  if (months <= 0 || totalCredits <= 0) return new Array(Math.max(0, months)).fill(0);
  const base = Math.floor(totalCredits / months);
  let remainder = totalCredits - base * months;
  const shares: number[] = [];
  for (let month = 0; month < months; month += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    shares.push(base + extra);
  }
  return shares;
}
