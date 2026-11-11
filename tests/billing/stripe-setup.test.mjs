// The Stripe account a deployment sells through: the price catalog the seed writes, how the seed
// reprices, and the webhook check the operator console runs. Only the Stripe transport is replaced.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ensurePrice, obsoletePrices } from '../../scripts/seed-stripe.ts';
import { stripeWebhookConfigurationErrors } from '../../src/features/billing/api/stripe-webhook-configuration.ts';
import { PLAN_PRODUCT_IDS, TOPUP_PRODUCT_ID } from '../../src/features/billing/catalog.ts';
import {
  invoiceGrantRef,
  invoiceGrantRefPrefix,
  topupGrantRef,
} from '../../src/features/billing/lib/grant-refs.ts';
import { diffIntendedPrice } from '../../src/features/billing/lib/stripe-catalog-diff.ts';
import { buildIntendedCatalog } from '../../src/features/billing/lib/stripe-plan.ts';
import { STRIPE_WEBHOOK_EVENTS } from '../../src/features/billing/lib/stripe-webhook-events.ts';
import {
  PLAN_TIERS,
  packagesForPlan,
  planAmountCents,
} from '../../src/features/billing/pricing-config.ts';

const intended = buildIntendedCatalog();
const first = intended[0];
const params = {
  product: first.productId,
  currency: 'usd',
  unit_amount: first.unitAmountCents,
  recurring: { interval: first.interval },
  metadata: first.metadata,
  nickname: first.nickname,
};
const existing = { id: 'price_existing', active: true, ...params };
const catalogProductIds = [...Object.values(PLAN_PRODUCT_IDS), TOPUP_PRODUCT_ID];

test('the catalog has one price per plan, interval and package, each charging its whole package', () => {
  assert.equal(new Set(intended.map((price) => price.lookupKey)).size, intended.length);
  for (const tier of PLAN_TIERS)
    for (const interval of ['month', 'year'])
      assert.deepEqual(
        intended.filter((p) => p.tier === tier && p.interval === interval).map((p) => p.credits),
        packagesForPlan(tier),
      );
  for (const price of intended) {
    assert.equal(price.unitAmountCents, planAmountCents(price.credits, price.interval));
    assert.equal(price.metadata.credits, String(price.credits));
    assert.equal(price.productId, PLAN_PRODUCT_IDS[price.tier]);
  }
});

test('grant references keep the forms existing ledger rows use, so a replay is recognised', () => {
  assert.equal(topupGrantRef('pi_test'), 'stripe:pi_test');
  assert.equal(invoiceGrantRef('in_test', 3), 'plan-invoice:in_test:3');
  assert.ok(invoiceGrantRef('in_test', 0).startsWith(invoiceGrantRefPrefix('in_test')));
});

test('a live plan price at another amount is reported, because subscribers are charged it', () => {
  const issues = diffIntendedPrice(first, {
    currency: 'usd',
    unitAmountCents: first.unitAmountCents * 2,
    productId: first.productId,
    interval: first.interval,
    metadata: first.metadata,
  });
  assert.deepEqual(
    issues.map((issue) => issue.field),
    ['amount'],
  );
});

test('the seed reuses a matching price and moves the lookup key before archiving a repriced one', async () => {
  const reuse = { prices: { list: async () => ({ data: [existing] }) } };
  assert.deepEqual(await ensurePrice(reuse, first.lookupKey, params), {
    id: existing.id,
    created: false,
  });
  for (const stale of [{ unit_amount: 1 }, { active: false }]) {
    const calls = [];
    const stripe = {
      prices: {
        list: async () => ({ data: [{ ...existing, ...stale }] }),
        create: async (input) => {
          calls.push(['create', input]);
          return { id: 'price_new' };
        },
        update: async (...args) => calls.push(['update', ...args]),
      },
    };
    assert.deepEqual(await ensurePrice(stripe, first.lookupKey, params), {
      id: 'price_new',
      created: true,
    });
    assert.deepEqual(calls[0], [
      'create',
      { ...params, lookup_key: first.lookupKey, transfer_lookup_key: true },
    ]);
  }
});

test('the seed retires only prices outside the catalog, and skips products not created yet', async () => {
  const scanned = [];
  const stripe = {
    products: {
      list: async (input) => ({
        data: input.ids.filter((id) => id !== TOPUP_PRODUCT_ID).map((id) => ({ id })),
      }),
    },
    prices: {
      list: ({ product }) =>
        (async function* () {
          scanned.push(product);
          yield { id: `${product}_obsolete`, lookup_key: `${product}_old` };
          yield { id: `${product}_unkeyed`, lookup_key: null };
          for (const price of intended.filter((p) => p.productId === product))
            yield { id: price.lookupKey, lookup_key: price.lookupKey };
        })(),
    },
  };
  const retired = await obsoletePrices(stripe, intended);
  assert.deepEqual(
    scanned,
    catalogProductIds.filter((id) => id !== TOPUP_PRODUCT_ID),
  );
  assert.equal(retired.length, scanned.length * 2);
  assert.ok(retired.every((price) => !intended.some((i) => i.lookupKey === price.lookup_key)));
});

test('the webhook check fails loudly unless one enabled endpoint here receives every needed event', async () => {
  const endpoint = {
    status: 'enabled',
    url: 'https://app.test/api/webhooks/stripe',
    enabled_events: [...STRIPE_WEBHOOK_EVENTS],
  };
  const errors = (endpoints) =>
    stripeWebhookConfigurationErrors(
      { webhookEndpoints: { list: () => endpoints } },
      'https://app.test',
    );
  assert.deepEqual(await errors([endpoint]), []);
  assert.deepEqual(await errors([{ ...endpoint, enabled_events: ['*'] }]), []);
  assert.deepEqual(await errors([{ ...endpoint, enabled_events: ['invoice.paid'] }, endpoint]), []);
  const missing = await errors([{ ...endpoint, enabled_events: ['invoice.paid'] }]);
  assert.match(missing[0], /customer.subscription.deleted/);
  assert.match(missing[0], /payment_intent.succeeded/);
  const elsewhere = await errors([
    { ...endpoint, status: 'disabled' },
    { ...endpoint, url: 'https://other.test/api/webhooks/stripe' },
  ]);
  assert.match(elsewhere[0], /No enabled/);
});
