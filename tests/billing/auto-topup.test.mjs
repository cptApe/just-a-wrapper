// When an automatic top-up may charge, and the monthly limit a customer sets on it. Charging,
// reconciling and cooldowns run against real rows in tests/integration/billing-topup-charges.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getTableColumns } from 'drizzle-orm';
import { workspace } from '../../src/db/schema/workspace.ts';
import {
  MIN_MONTHLY_CAP_CENTS,
  monthlyCapError,
} from '../../src/features/billing/lib/auto-topup-cap.ts';
import {
  canCreateAutoTopupPayment,
  reservedAfterPendingRetry,
} from '../../src/features/billing/lib/auto-topup-policy.ts';
import {
  AUTO_TOPUP,
  CREDIT_PACKAGES,
  PLANS,
  planAmountCents,
  topupAmountCents,
} from '../../src/features/billing/pricing-config.ts';

test('an automatic top-up charges only when on, on a plan, below the threshold and within the cap', () => {
  const allowed = {
    enabled: true,
    paidTier: true,
    balance: 50,
    thresholdCredits: 100,
    reservedAfterAttemptCents: 3_000,
    monthlyCapCents: 10_000,
  };
  assert.equal(canCreateAutoTopupPayment(allowed), true);
  for (const refused of [
    { enabled: false },
    { paidTier: false },
    { balance: 101 },
    { reservedAfterAttemptCents: 10_001 },
  ]) {
    assert.equal(
      canCreateAutoTopupPayment({ ...allowed, ...refused }),
      false,
      JSON.stringify(refused),
    );
  }
});

test('the default refill is a package that fits each plan default cap, and new rows use it', () => {
  assert.ok(CREDIT_PACKAGES.includes(AUTO_TOPUP.defaultCredits));
  const amountCents = topupAmountCents(AUTO_TOPUP.defaultCredits);
  for (const plan of Object.values(PLANS)) {
    const capCents = planAmountCents(plan.minCredits, 'month');
    assert.equal(
      canCreateAutoTopupPayment({
        enabled: true,
        paidTier: true,
        balance: AUTO_TOPUP.thresholdCredits,
        thresholdCredits: AUTO_TOPUP.thresholdCredits,
        reservedAfterAttemptCents: amountCents,
        monthlyCapCents: capCents,
      }),
      true,
      `${plan.name}: the default cap cannot fund one refill`,
    );
  }
  const columns = getTableColumns(workspace);
  assert.equal(columns.autoTopupThresholdCredits.default, AUTO_TOPUP.thresholdCredits);
  assert.equal(columns.autoTopupCredits.default, AUTO_TOPUP.defaultCredits);
});

test('a pending retry from last month counts against the cap of the month it charges in', () => {
  const monthStart = new Date('2026-09-01T00:00:00.000Z');
  assert.equal(
    reservedAfterPendingRetry(8_000, 3_000, new Date('2026-08-31T23:59:59.999Z'), monthStart),
    11_000,
  );
  assert.equal(reservedAfterPendingRetry(8_000, 3_000, monthStart, monthStart), 8_000);
});

test('the monthly limit refuses an unusable amount with the sentence the customer reads', () => {
  const max = AUTO_TOPUP.maxMonthlyCapCents / 100;
  const min = MIN_MONTHLY_CAP_CENTS / 100;
  for (const [enabled, monthlyCapDollars, error] of [
    [true, 250, null],
    [false, 250, null],
    [true, min, null],
    [true, max, null],
    [false, 0, null],
    [true, 0, 'Set a monthly limit of at least $1 to turn this on.'],
    [true, max + 1, 'The most you can set is $10,000 a month.'],
    [false, max + 1, 'The most you can set is $10,000 a month.'],
    [true, 12.5, 'Enter a whole dollar amount.'],
    [true, -1, 'Enter a whole dollar amount.'],
    [true, Number.NaN, 'Enter a whole dollar amount.'],
  ]) {
    assert.equal(
      monthlyCapError({ enabled, monthlyCapDollars }),
      error,
      `${enabled} ${monthlyCapDollars}`,
    );
  }
});
