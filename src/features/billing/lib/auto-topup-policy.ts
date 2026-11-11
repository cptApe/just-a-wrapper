export const AUTO_TOPUP_COOLDOWN_STATUSES = ['failed'] as const;

export function canCreateAutoTopupPayment(input: {
  enabled: boolean;
  paidTier: boolean;
  balance: number;
  thresholdCredits: number;
  reservedAfterAttemptCents: number;
  monthlyCapCents: number;
}): boolean {
  return (
    input.enabled &&
    input.paidTier &&
    input.balance <= input.thresholdCredits &&
    input.reservedAfterAttemptCents <= input.monthlyCapCents
  );
}

export function reservedAfterPendingRetry(
  currentMonthReservedCents: number,
  pendingAmountCents: number,
  pendingCreatedAt: Date,
  currentMonthStart: Date,
): number {
  return (
    currentMonthReservedCents + (pendingCreatedAt < currentMonthStart ? pendingAmountCents : 0)
  );
}
