// What usage and purchases cost in credits. One credit is one cent of vendor cost; the margin
// lives in what a credit sells for. A wrong number here is a wrong charge on every customer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  containerRuntimeCents,
  creditsDueForSessionTotal,
  creditsForVendorCents,
  MODEL_PRICING_CENTS,
  modelRequestCents,
  TIER_CREDIT_MULTIPLIER,
} from '../../src/features/billing/lib/credit-math.ts';
import { roundVendorCents } from '../../src/features/billing/lib/round-vendor-cents.ts';
import {
  CENTS_PER_CREDIT,
  CREDIT_BLOCK,
  CREDIT_PACKAGES,
  creditBlockPriceCents,
  creditsCostCents,
  isTopupCredits,
  MARGIN_PERCENT,
  STARTER_PACK_CREDITS,
  STRIPE_MAX_CHARGE_CENTS,
  topupAmountCents,
} from '../../src/features/billing/pricing-config.ts';

const ZERO = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
const M = 1_000_000;

test('a model request costs its published token rates, exactly, on every tier', () => {
  for (const [tier, usage, cents] of [
    // Balanced: $2 in, $10 out, cache write 1.25x and read 0.1x of input.
    ['default', { inputTokens: M, outputTokens: M }, 1_200],
    ['default', { inputTokens: 150_000, outputTokens: 150_000 }, 180],
    ['default', { cacheCreationTokens: M }, 250],
    ['default', { cacheReadTokens: M }, 20],
    // Long-prompt rates belong to Fast only.
    ['default', { inputTokens: 200_000 }, 40],
    // Expert: $4 in, so cache write $5 and read $0.40.
    ['pro', { cacheCreationTokens: M }, 500],
    ['pro', { cacheReadTokens: M }, 40],
    // Fast: $0.10 in, $0.50 out up to a 100K prompt; past it every token takes the long rates.
    ['fast', { inputTokens: 100_000, outputTokens: M }, 51],
    ['fast', { inputTokens: 1, outputTokens: M, cacheReadTokens: 100_000 }, 250.50005],
    // An errored request with no usage costs nothing.
    ['default', {}, 0],
    ['pro', {}, 0],
  ]) {
    assert.equal(
      modelRequestCents(tier, { ...ZERO, ...usage }),
      cents,
      `${tier} ${JSON.stringify(usage)}`,
    );
  }
});

test('the tier multiplier shown to people is the real per-token price ratio', () => {
  for (const tier of ['fast', 'pro']) {
    const rates = MODEL_PRICING_CENTS[tier];
    const balanced = MODEL_PRICING_CENTS.default;
    assert.equal(rates.inputPerMTok / balanced.inputPerMTok, TIER_CREDIT_MULTIPLIER[tier]);
    assert.equal(rates.outputPerMTok / balanced.outputPerMTok, TIER_CREDIT_MULTIPLIER[tier]);
  }
});

test('vendor cents become credits rounded up, without float dust adding a credit', () => {
  assert.equal(CENTS_PER_CREDIT, 1);
  for (const [cents, credits] of [
    [0, 0],
    [1, 1],
    [150, 150],
    // An image at 5.3 cents costs 6 credits.
    [5.3, 6],
    // Exa reports dollars, and 0.07 * 100 is 7.000000000000001 in floating point.
    [0.07 * 100, 7],
    [0.14 * 100, 14],
  ]) {
    assert.equal(creditsForVendorCents(cents), credits, String(cents));
  }
});

test('sandbox time is 8 cents an hour, exact to the second', () => {
  assert.equal(containerRuntimeCents(0), 0);
  assert.equal(containerRuntimeCents(3600), 8);
  assert.equal(containerRuntimeCents(7200), 16);
  assert.equal(roundVendorCents(containerRuntimeCents(45)), 0.1);
});

test('a session is charged once for its rounding, never negative', () => {
  const tiny = modelRequestCents('default', { ...ZERO, inputTokens: 100, outputTokens: 50 });
  assert.equal(creditsDueForSessionTotal(tiny, 0), 1);
  assert.equal(creditsDueForSessionTotal(tiny * 2, 1), 0);
  assert.equal(creditsDueForSessionTotal(0.5, 3), 0);
});

test('a vendor cost that is negative or not a number is refused before it is stored', () => {
  assert.equal(roundVendorCents(0.1333333333), 0.133333);
  for (const cents of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => roundVendorCents(cents), { code: 'VALIDATION_FAILED' });
  }
});

test('a credit sells for its cost marked up by exactly the configured margin', () => {
  assert.equal(
    creditBlockPriceCents(),
    (CREDIT_BLOCK * CENTS_PER_CREDIT * 100) / (100 - MARGIN_PERCENT),
  );
  assert.ok(topupAmountCents(STARTER_PACK_CREDITS) >= creditsCostCents(STARTER_PACK_CREDITS));
});

test('a one-time purchase is any whole number from 500 up to the largest Stripe charge', () => {
  for (const credits of [500, 501, 1_234, 50_000, 1_000_000, 99_999_999]) {
    assert.equal(isTopupCredits(credits), true, String(credits));
  }
  for (const credits of [499, 0, -500, 500.5, Number.NaN, Number.POSITIVE_INFINITY, 100_000_000]) {
    assert.equal(isTopupCredits(credits), false, String(credits));
  }
  assert.ok(STRIPE_MAX_CHARGE_CENTS <= 2_147_483_647, 'the ceiling fits the credit column');
});

test('a one-time purchase costs one cent a credit with no rounding up, and odd small amounts have no price', () => {
  for (const credits of [500, 501, 1_234, 99_999_999, ...CREDIT_PACKAGES]) {
    assert.equal(topupAmountCents(credits), credits, String(credits));
  }
  for (const credits of [0, -250, 150, 250]) {
    assert.throws(() => topupAmountCents(credits), { code: 'VALIDATION_FAILED' });
  }
});
