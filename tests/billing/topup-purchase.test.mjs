// Buying credits once: the amount the route accepts, what Stripe is asked to charge, which card
// pays and when credits are granted. Only Stripe, customer creation, grants and env are replaced;
// the grant itself and its idempotency run on Postgres in tests/integration/billing-topup-grants.test.ts.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { beforeEach, test } from 'node:test';
import Stripe from 'stripe';
import { z } from 'zod';
import { defaultCardPaymentMethod } from '../../src/features/billing/api/default-card-payment-method.ts';
import { buildCheckoutSuccessUrl } from '../../src/features/billing/lib/checkout-return-url.ts';
import {
  decideFromIntentStatus,
  topupCardFailureReason,
} from '../../src/features/billing/lib/topup-charge-decision.ts';
import { isTopupCredits } from '../../src/features/billing/pricing-config.ts';
import { AppError } from '../../src/lib/errors.ts';
import { loadTsx } from '../support/load-tsx.mjs';

registerHooks({
  resolve(specifier, context, nextResolve) {
    const replacements = {
      '@/lib/stripe':
        'export const getStripe = () => globalThis.__topupStripe; export const requireStripe = getStripe',
      '@/lib/env': 'export const env = { NEXT_PUBLIC_APP_URL: "https://app.example.test" }',
      './ensure-customer': 'export const ensureCustomer = async (_, ws) => ws.stripeCustomerId',
      './grant-topup':
        'export const grantTopupAndResume = async (id, grant) => { globalThis.__topupGrants.push({ id, ...grant }); return { kind: "granted", balance: grant.credits }; }',
      './manual-topup-transitions':
        'export const openManualTopupAttempt = async () => ({ status: "open", stripePaymentIntentId: null, createdAt: new Date(), pastIdempotencyWindow: false }); export const moveManualTopupAttempt = async () => true;',
      './reconcile-manual-topup': 'export const reconcileManualTopup = async () => ({})',
    };
    if (replacements[specifier])
      return {
        url: `data:text/javascript,${encodeURIComponent(replacements[specifier])}`,
        shortCircuit: true,
      };
    return nextResolve(specifier, context);
  },
});
const { createTopupCheckoutSession } = await import(
  '../../src/features/billing/api/create-topup-checkout-session.ts'
);
const { chargeTopup } = await import('../../src/features/billing/api/charge-topup.ts');

const workspace = {
  id: 'ws_test',
  organizationId: 'org_test',
  stripeCustomerId: 'cus_test',
  stripeSubscriptionId: null,
  planBillingInterval: 'month',
};
let checkouts;
beforeEach(() => {
  checkouts = [];
  globalThis.__topupGrants = [];
  globalThis.__topupStripe = {
    checkout: {
      sessions: {
        list: async () => ({ data: [] }),
        create: async (params) => {
          checkouts.push(params);
          return { url: 'https://checkout.stripe.test/session', status: 'open' };
        },
      },
    },
  };
});

function topupRoute(charges) {
  const parseJsonBody = async (request, schema) => {
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw new AppError('INVALID_BODY', 'Request body failed validation');
    return parsed.data;
  };
  return loadTsx('src/app/api/billing/topup/route.ts', (name) => {
    if (name === 'zod') return { z };
    if (name === 'next/headers') return { headers: async () => new Headers() };
    if (name === '@/lib/assert-expected-organization') return { assertExpectedOrganization() {} };
    if (name === '@/lib/route-kit') return { parseJsonBody, withApiRoute: (_options, run) => run };
    if (name === '@/features/billing')
      return {
        isTopupCredits,
        getTopupOptions: async () => ({}),
        requireBillingAdmin: async () => ({ id: 'ws', organizationId: 'org' }),
        chargeTopup: async (input) => {
          charges.push(input);
          return { outcome: 'charged', credits: input.credits, balance: input.credits };
        },
      };
    throw new Error(name);
  }).POST;
}

test('the top-up route refuses an amount that is not a purchase before anything is charged', async () => {
  const charges = [];
  const POST = topupRoute(charges);
  for (const credits of [0, -500, 100, 499, 750.5, 100_000_000, '500', 'abc', null]) {
    const request = new Request('https://app.test/api/billing/topup', {
      method: 'POST',
      body: JSON.stringify({ expectedOrganizationId: 'org', credits, idempotencyKey: 'attempt' }),
    });
    await assert.rejects(POST(request), { code: 'INVALID_BODY' }, String(credits));
  }
  assert.deepEqual(charges, []);
});

test('Checkout charges exactly the chosen credits in cents and carries them to the grant', async () => {
  for (const credits of [501, 1234, 2500]) {
    await createTopupCheckoutSession({ workspace, credits });
    const request = checkouts.at(-1);
    assert.equal(request.mode, 'payment');
    assert.deepEqual(request.line_items, [
      {
        price_data: {
          product: 'just_a_wrapper_credit_topup',
          currency: 'usd',
          unit_amount: credits,
        },
        quantity: 1,
      },
    ]);
    assert.equal(request.metadata.credits, String(credits));
    assert.deepEqual(request.payment_intent_data.metadata, request.metadata);
  }
  for (const credits of [0, -100, 150, 250])
    await assert.rejects(createTopupCheckoutSession({ workspace, credits }), {
      code: 'VALIDATION_FAILED',
    });
  assert.equal(checkouts.length, 3);
});

test('a Checkout Stripe reports complete is already charged, so no second payment opens', async () => {
  globalThis.__topupStripe.checkout.sessions.create = async () => ({
    id: 'cs_paid',
    status: 'complete',
    url: 'https://completed.test',
  });
  assert.deepEqual(
    await createTopupCheckoutSession({ workspace, credits: 1000, idempotencyKey: 'old' }),
    { outcome: 'already_charged' },
  );
});

test('Checkout returns with the literal session placeholder Stripe fills in', () => {
  assert.equal(
    buildCheckoutSuccessUrl('https://example.com/base', 'topup'),
    'https://example.com/app/settings/billing?checkout=success&topup=success&session_id={CHECKOUT_SESSION_ID}',
  );
});

test('a saved card is charged once for exactly the credits it grants', async () => {
  const intents = [];
  globalThis.__topupStripe.customers = {
    retrieve: async () => ({ invoice_settings: { default_payment_method: 'pm_saved' } }),
  };
  globalThis.__topupStripe.paymentIntents = {
    create: async (params, options) => {
      intents.push({ params, options });
      return { id: 'pi_1234', status: 'succeeded', lastResponse: { headers: {} } };
    },
  };
  const result = await chargeTopup({ workspace, credits: 1_234, idempotencyKey: 'attempt_saved' });
  assert.deepEqual(result, { outcome: 'charged', credits: 1_234, balance: 1_234 });
  assert.equal(intents.length, 1);
  assert.equal(intents[0].params.amount, 1_234);
  assert.equal(intents[0].params.off_session, true);
  assert.equal(intents[0].options.idempotencyKey, 'topup:ws_test:attempt_saved');
  assert.deepEqual(globalThis.__topupGrants, [
    { id: 'pi_1234', customerId: 'cus_test', credits: 1_234 },
  ]);
});

test('only a settled payment grants; money in flight waits instead of opening a second charge', () => {
  assert.equal(decideFromIntentStatus('succeeded'), 'charged');
  // A second Checkout while funds are processing would let both settle: a double charge.
  assert.equal(decideFromIntentStatus('processing'), 'processing');
  for (const status of [
    'requires_action',
    'requires_payment_method',
    'requires_confirmation',
    'requires_capture',
    'canceled',
  ]) {
    assert.equal(decideFromIntentStatus(status), 'fallback', status);
  }
  for (const [error, reason] of [
    [{ code: 'authentication_required' }, 'authentication_required'],
    [{ code: 'card_declined', decline_code: 'authentication_required' }, 'authentication_required'],
    [{ code: 'card_declined', decline_code: 'insufficient_funds' }, 'declined'],
  ]) {
    assert.equal(topupCardFailureReason(error), reason);
  }
});

test('the subscription card pays first, then the customer default, and never another saved card', async () => {
  const cards = (subscription, customer) => ({
    subscriptions: { retrieve: async () => subscription },
    customers: { retrieve: async () => customer },
  });
  const missing = new Stripe.errors.StripeInvalidRequestError({
    code: 'resource_missing',
    message: 'No such subscription',
  });
  for (const [label, stripe, subscriptionId, expected] of [
    ['subscription card', cards({ default_payment_method: 'pm_sub' }, null), 'sub', 'pm_sub'],
    [
      'customer default',
      cards(
        { default_payment_method: null },
        { invoice_settings: { default_payment_method: 'pm_c' } },
      ),
      'sub',
      'pm_c',
    ],
    [
      'missing subscription',
      {
        subscriptions: {
          retrieve: async () => {
            throw missing;
          },
        },
        customers: {
          retrieve: async () => ({ invoice_settings: { default_payment_method: 'pm_c' } }),
        },
      },
      'sub_gone',
      'pm_c',
    ],
    ['no default', cards(null, { invoice_settings: { default_payment_method: null } }), null, null],
    ['deleted customer', cards(null, { deleted: true }), null, null],
  ]) {
    assert.deepEqual(
      await defaultCardPaymentMethod(stripe, 'cus', subscriptionId, 'id'),
      expected,
      label,
    );
  }
});

test('a Stripe outage while finding the card fails loudly instead of reading as no card', async () => {
  const cause = new Stripe.errors.StripeAPIError({ message: 'Unavailable' });
  const failing = async () => {
    throw cause;
  };
  await assert.rejects(
    defaultCardPaymentMethod({ customers: { retrieve: failing } }, 'cus', null, 'id'),
    (error) => error.code === 'EXTERNAL_API_FAILED' && error.cause === cause,
  );
  await assert.rejects(
    defaultCardPaymentMethod(
      {
        subscriptions: { retrieve: failing },
        customers: { retrieve: async () => assert.fail('must not fall back during an outage') },
      },
      'cus',
      'sub_test',
      'id',
    ),
    (error) => error.cause === cause && error.context.subscriptionId === 'sub_test',
  );
});
