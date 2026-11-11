// What a plan costs, when a change is paid, what a part payment grants and how long credits live.
// The Stripe and ledger code around these numbers runs on real Postgres in
// tests/integration/billing-plan-webhooks.test.ts and billing-subscriptions.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allocateGrantConsumption } from '../../src/features/billing/lib/credit-grants.ts';
import { planChangeTiming } from '../../src/features/billing/lib/plan-picker-packs.ts';
import {
  creditsDeliveredPerBlock,
  creditsForPaidCents,
  splitCreditsAcrossMonths,
} from '../../src/features/billing/lib/webhook-credit-split.ts';
import {
  blocksForCredits,
  blockUnitAmountCents,
  CREDIT_BLOCK,
  CREDIT_PACKAGES,
  creditBlockPriceCents,
  effectiveYearlyMonthlyAmountCents,
  expiresAtMonthsAfter,
  PLAN_TIERS,
  PLANS,
  packagesForPlan,
  planAmountCents,
  planCreditExpiryMonths,
  STARTER_PACK_CREDITS,
  topupAmountCents,
  YEARLY_CHARGED_MONTHS,
  YEARLY_DELIVERED_MONTHS,
} from '../../src/features/billing/pricing-config.ts';

test('a package costs its blocks at the block price, in whole cents, the same as buying once', () => {
  const block = creditBlockPriceCents();
  for (const credits of CREDIT_PACKAGES) {
    const monthly = planAmountCents(credits, 'month');
    assert.equal(monthly, (credits / CREDIT_BLOCK) * block);
    assert.equal(topupAmountCents(credits), monthly, `${credits}: a top-up costs more than a plan`);
    for (const amount of [monthly, planAmountCents(credits, 'year')]) {
      assert.ok(Number.isInteger(amount), `${credits} credits priced at ${amount}`);
    }
  }
  assert.equal(planAmountCents(PLANS.pro.minCredits, 'month'), 1_000);
  assert.equal(planAmountCents(PLANS.max.minCredits, 'month'), 5_000);
});

test('a year charges ten months, delivers twelve and quotes its monthly share', () => {
  for (const credits of CREDIT_PACKAGES) {
    assert.equal(
      planAmountCents(credits, 'year'),
      planAmountCents(credits, 'month') * YEARLY_CHARGED_MONTHS,
    );
  }
  assert.equal(YEARLY_DELIVERED_MONTHS, 12);
  assert.equal(effectiveYearlyMonthlyAmountCents(planAmountCents(1_000, 'year')), 833);
});

test('a plan sells every package from its minimum up, and never the starter pack', () => {
  for (const tier of PLAN_TIERS) {
    const offered = packagesForPlan(tier);
    assert.equal(offered[0], PLANS[tier].minCredits);
    assert.ok(CREDIT_PACKAGES.includes(PLANS[tier].minCredits));
    assert.ok(offered.every((credits) => credits >= PLANS[tier].minCredits));
    assert.equal(offered.includes(STARTER_PACK_CREDITS), false);
  }
  assert.ok(STARTER_PACK_CREDITS < CREDIT_PACKAGES[0]);
});

test('a credit count that is not a whole number of blocks is refused, not rounded', () => {
  assert.equal(blocksForCredits(20_000), 200);
  for (const bad of [0, -100, 150, 1.5]) {
    assert.throws(() => blocksForCredits(bad), /positive multiple/);
  }
});

test('a bigger plan, package or a move to yearly is paid now; the rest wait for renewal', () => {
  const at = (tier, interval, amountCents) => ({ tier, interval, amountCents });
  for (const [from, to, timing] of [
    [at('pro', 'month', 1000), at('pro', 'month', 2000), 'now'],
    [at('pro', 'month', 1000), at('max', 'month', 1000), 'now'],
    [at('pro', 'month', 1000), at('pro', 'year', 10000), 'now'],
    [at('pro', 'month', 2000), at('pro', 'month', 1000), 'next_renewal'],
    [at('max', 'month', 5000), at('pro', 'month', 7500), 'next_renewal'],
    // A prepaid year never ends early.
    [at('pro', 'year', 10000), at('max', 'month', 5000), 'next_renewal'],
  ]) {
    assert.equal(
      planChangeTiming(from, to),
      timing,
      `${JSON.stringify(from)} -> ${JSON.stringify(to)}`,
    );
  }
});

test('a part payment grants only the credits its cents bought, never a rounded-up credit', () => {
  for (const credits of [1_000, 1_500, 5_000, 50_000]) {
    assert.equal(creditsForPaidCents(planAmountCents(credits, 'month'), 'month'), credits);
  }
  for (const [cents, interval, credits] of [
    // Moving from Pro 400 to Pro 20,000 on day 29 of 30 collects 3,267 cents: 3,267 credits, not 19,600.
    [3_267, 'month', 3_267],
    [99.5, 'month', 99],
    [0.5, 'month', 0],
    [blockUnitAmountCents('month') - 1, 'month', CREDIT_BLOCK - 1],
    [0, 'month', 0],
    [-500, 'month', 0],
    [null, 'month', 0],
    [undefined, 'year', 0],
    [Number.NaN, 'month', 0],
  ]) {
    assert.equal(creditsForPaidCents(cents, interval), credits, `${cents} ${interval}`);
  }
});

test('a yearly payment delivers every month, and half a year left buys half the credits', () => {
  assert.equal(creditsDeliveredPerBlock('year'), CREDIT_BLOCK * YEARLY_DELIVERED_MONTHS);
  const fullYear = planAmountCents(400, 'year');
  assert.equal(creditsForPaidCents(fullYear, 'year'), 400 * YEARLY_DELIVERED_MONTHS);
  assert.equal(creditsForPaidCents(fullYear / 2, 'year'), 200 * YEARLY_DELIVERED_MONTHS);
});

test('credits spread over months add up to exactly what was paid', () => {
  assert.deepEqual(splitCreditsAcrossMonths(4_800, 12), new Array(12).fill(400));
  assert.deepEqual(splitCreditsAcrossMonths(10, 3), [4, 3, 3]);
  assert.deepEqual(splitCreditsAcrossMonths(0, 3), [0, 0, 0]);
  assert.deepEqual(splitCreditsAcrossMonths(500, 0), []);
  for (const total of [1, 7, 653, 4_805, 19_999]) {
    for (const months of [1, 2, 5, 11, 12]) {
      const split = splitCreditsAcrossMonths(total, months);
      assert.equal(split.length, months);
      assert.equal(
        split.reduce((sum, share) => sum + share, 0),
        total,
      );
      assert.ok(split.every((share) => Number.isInteger(share) && share >= 0));
    }
  }
});

test('a month of plan credits runs out as the next month arrives, clamped on short months', () => {
  assert.equal(planCreditExpiryMonths(), 1);
  const paidAt = new Date('2026-01-15T09:00:00.000Z');
  for (let month = 0; month + 1 < YEARLY_DELIVERED_MONTHS; month += 1) {
    const issued = expiresAtMonthsAfter(paidAt, month);
    assert.equal(
      expiresAtMonthsAfter(issued, planCreditExpiryMonths()).toISOString(),
      expiresAtMonthsAfter(paidAt, month + 1).toISOString(),
      `month ${month} does not hand over cleanly`,
    );
  }
  for (const [from, months, to] of [
    ['2026-01-31T12:34:56.789Z', 1, '2026-02-28T12:34:56.789Z'],
    ['2028-01-31T00:00:00.000Z', 1, '2028-02-29T00:00:00.000Z'],
    ['2028-02-29T00:00:00.000Z', 12, '2029-02-28T00:00:00.000Z'],
  ]) {
    assert.equal(expiresAtMonthsAfter(new Date(from), months).toISOString(), to);
  }
});

test('spending takes credits from the grant that expires first', () => {
  const issuedAt = new Date('2026-08-01T00:00:00Z');
  assert.deepEqual(
    allocateGrantConsumption(
      [
        { id: 'topup', amount: 100, consumed: 0, issuedAt, expiresAt: new Date('2027-08-01') },
        { id: 'plan', amount: 50, consumed: 10, issuedAt, expiresAt: new Date('2026-10-01') },
      ],
      60,
    ),
    [
      { id: 'plan', credits: 40 },
      { id: 'topup', credits: 20 },
    ],
  );
});
