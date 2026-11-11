// Charging top-ups on real Postgres: which saved card is charged, manual and automatic attempts, and Stripe idempotency windows.
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadBillingWorkspace } from '@/features/billing/api/resolve-workspace';
import { CENTS_PER_CREDIT } from '@/features/billing/pricing-config';
import type { Caller } from '@/lib/caller';
import { applyMigrations, seedOrganization, truncateAll } from './helpers/schema-setup';
import { makeTestDb, makeTestPool } from './helpers/test-db';

const stripeNetwork = vi.hoisted(() => ({
  retrieveSubscription: vi.fn(),
  retrieveCustomer: vi.fn(),
  createIntent: vi.fn(),
  retrieveIntent: vi.fn(),
  cancelIntent: vi.fn(),
  createCheckout: vi.fn(),
  listIntents: vi.fn(),
  listCheckouts: vi.fn(),
}));
vi.mock('@/lib/stripe', () => {
  const boundary = {
    getStripe: () => ({
      subscriptions: { retrieve: stripeNetwork.retrieveSubscription },
      customers: { retrieve: stripeNetwork.retrieveCustomer },
      paymentIntents: {
        create: stripeNetwork.createIntent,
        retrieve: stripeNetwork.retrieveIntent,
        cancel: stripeNetwork.cancelIntent,
        list: stripeNetwork.listIntents,
      },
      checkout: {
        sessions: { create: stripeNetwork.createCheckout, list: stripeNetwork.listCheckouts },
      },
    }),
  };
  return { ...boundary, requireStripe: boundary.getStripe };
});
const ORG = 'org_default_card';
const callerIn = (workspaceId: string): Caller => ({
  userId: 'user_default',
  email: 'test@example.com',
  name: 'Test',
  organizationId: ORG,
  workspaceId,
  workspaceName: 'Test',
  role: 'owner',
});
const { chargeTopup } = await import('@/features/billing/api/charge-topup');
const { createTopupCheckoutSession } = await import(
  '@/features/billing/api/create-topup-checkout-session'
);
const { withRequestContext } = await import('@/lib/request-context');
const { maybeAutoTopup, finishPendingAutoTopup } = await import(
  '@/features/billing/api/maybe-auto-topup'
);
const pool = makeTestPool();
const db = makeTestDb(pool);
beforeAll(async () => {
  await applyMigrations(db);
});
beforeEach(async () => {
  await truncateAll(db);
  await seedOrganization(db, ORG);
  stripeNetwork.listIntents.mockReset().mockImplementation(async function* () {
    yield* [];
  });
  stripeNetwork.listCheckouts.mockReset().mockImplementation(async function* () {
    yield* [];
  });
  stripeNetwork.retrieveIntent.mockReset();
  stripeNetwork.cancelIntent.mockReset().mockResolvedValue({ status: 'canceled' });
  stripeNetwork.createCheckout
    .mockReset()
    .mockResolvedValue({ url: 'https://checkout.stripe.test/retry', status: 'open' });
  stripeNetwork.retrieveSubscription
    .mockReset()
    .mockResolvedValue({ default_payment_method: 'pm_subscription' });
  stripeNetwork.retrieveCustomer
    .mockReset()
    .mockResolvedValue({ invoice_settings: { default_payment_method: null } });
  stripeNetwork.createIntent.mockReset().mockResolvedValue({
    id: 'pi_auto_default',
    status: 'processing',
    lastResponse: { headers: {} },
  });
});
afterAll(async () => {
  await pool.end();
});

// A Pro workspace whose card is saved on the subscription.
async function seedWorkspace(
  autoTopup: { enabled: boolean; armed?: boolean } = { enabled: false },
): Promise<string> {
  const id = randomUUID();
  await db.execute(sql`insert into workspace (id, organization_id, name, stripe_customer_id, stripe_subscription_id, plan_tier, plan_credits, plan_billing_interval, auto_topup_enabled)
    values (${id}, ${ORG}, 'Card', 'cus_default', 'sub_default', 'pro', 1000, 'month', ${autoTopup.enabled})`);
  if (autoTopup.armed)
    await db.execute(sql`update workspace set auto_topup_threshold_credits = 20, auto_topup_credits = 400, auto_topup_monthly_cap_cents = 25000
      where id = ${id}`);
  return id;
}

function buyManually(workspaceId: string, credits: number, idempotencyKey: string) {
  return withRequestContext({ route: 'test/manual-topup' }, async () =>
    chargeTopup({
      workspace: await loadBillingWorkspace(callerIn(workspaceId)),
      credits,
      idempotencyKey,
    }),
  );
}

async function attemptRows(table: 'auto_topup_attempt' | 'manual_topup_attempt', id: string) {
  const { rows } = await db.execute(
    sql`select status, stripe_payment_intent_id from ${sql.raw(table)} where workspace_id = ${id}`,
  );
  return rows;
}

describe('which card is charged', () => {
  test('auto top-up charges a card saved only on the subscription', async () => {
    const id = await seedWorkspace({ enabled: true, armed: true });
    await maybeAutoTopup(id);
    expect(stripeNetwork.createIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 400 * CENTS_PER_CREDIT,
        payment_method: 'pm_subscription',
        customer: 'cus_default',
        off_session: true,
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) }),
    );
    expect(stripeNetwork.retrieveSubscription).toHaveBeenCalledWith('sub_default');
    expect(await attemptRows('auto_topup_attempt', id)).toEqual([
      { status: 'pending', stripe_payment_intent_id: 'pi_auto_default' },
    ]);
  });

  test('manual top-up charges a card saved only on the subscription', async () => {
    const id = await seedWorkspace();
    expect(await buyManually(id, 400, 'manual_default')).toEqual({ outcome: 'processing' });
    expect(stripeNetwork.retrieveSubscription).toHaveBeenCalledWith('sub_default');
    expect(stripeNetwork.createIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_method: 'pm_subscription',
        customer: 'cus_default',
        off_session: true,
        confirm: true,
      }),
      { idempotencyKey: `topup:${id}:manual_default` },
    );
  });

  test('a saved card that needs the customer present is cancelled and charges nothing', async () => {
    const id = await seedWorkspace();
    stripeNetwork.createIntent.mockResolvedValue({
      id: 'pi_retry',
      status: 'requires_action',
      lastResponse: { headers: {} },
    });
    stripeNetwork.retrieveIntent.mockResolvedValue({ id: 'pi_retry', status: 'requires_action' });
    expect(await buyManually(id, 400, 'manual_retry')).toEqual({
      outcome: 'card_failed',
      reason: 'authentication_required',
    });
    expect(stripeNetwork.cancelIntent).toHaveBeenCalledTimes(1);
    expect(stripeNetwork.createCheckout).not.toHaveBeenCalled();
  });

  test('a workspace with no saved card is sent to Checkout without a charge', async () => {
    const id = await seedWorkspace();
    stripeNetwork.retrieveSubscription.mockResolvedValue({ default_payment_method: null });
    stripeNetwork.retrieveCustomer.mockResolvedValue({
      deleted: false,
      invoice_settings: { default_payment_method: null },
    });
    stripeNetwork.createCheckout.mockResolvedValue({
      id: 'cs_no_card',
      status: 'open',
      url: 'https://checkout.stripe.test/no-card',
    });
    expect(await buyManually(id, 400, 'no_card')).toEqual({
      outcome: 'fallback',
      url: 'https://checkout.stripe.test/no-card',
    });
    expect(stripeNetwork.createIntent).not.toHaveBeenCalled();
  });

  test('a top-up charges exactly the price of its credits, by saved card and by Checkout', async () => {
    const id = await seedWorkspace();
    await buyManually(id, 400, 'priced_card');
    expect(stripeNetwork.createIntent.mock.calls[0]?.[0]).toMatchObject({
      amount: 400 * CENTS_PER_CREDIT,
    });

    stripeNetwork.retrieveSubscription.mockResolvedValue({ default_payment_method: null });
    stripeNetwork.retrieveCustomer.mockResolvedValue({
      deleted: false,
      invoice_settings: { default_payment_method: null },
    });
    await buyManually(id, 1000, 'priced_checkout');
    expect(stripeNetwork.createCheckout.mock.calls[0]?.[0]).toMatchObject({
      line_items: [{ price_data: { unit_amount: 1000 * CENTS_PER_CREDIT }, quantity: 1 }],
    });
  });

  test('a top-up Checkout refuses promotion codes, which could remove the payment intent the grant keys on', async () => {
    const id = await seedWorkspace({ enabled: true });
    stripeNetwork.createCheckout.mockResolvedValue({
      status: 'open',
      url: 'https://checkout.stripe.test/session',
    });
    await createTopupCheckoutSession({
      workspace: {
        id,
        organizationId: ORG,
        name: 'Card',
        stripeCustomerId: 'cus_default',
        stripeSubscriptionId: 'sub_default',
        creditBalance: 100,
        creditResetAt: null,
        planTier: 'pro',
        planBillingInterval: 'month',
        planCredits: 1000,
        autoTopupEnabled: true,
        autoTopupThresholdCredits: 100,
        autoTopupCredits: 1000,
        autoTopupMonthlyCapCents: 100000,
        userEmail: 'owner@example.test',
        userId: 'owner',
      },
      credits: 1000,
      idempotencyKey: 'topup',
    });
    expect(stripeNetwork.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ allow_promotion_codes: false }),
      expect.anything(),
    );
  });
});

describe('manual top-ups charge once', () => {
  test('a repeated purchase key reuses one Stripe charge and refuses a different pack', async () => {
    const id = await seedWorkspace();
    expect(await buyManually(id, 400, 'manual_recorded')).toEqual({ outcome: 'processing' });
    expect(await buyManually(id, 400, 'manual_recorded')).toEqual({ outcome: 'processing' });
    expect(stripeNetwork.createIntent).toHaveBeenCalledTimes(2);
    for (const [, options] of stripeNetwork.createIntent.mock.calls)
      expect(options).toEqual({ idempotencyKey: `topup:${id}:manual_recorded` });
    expect(await attemptRows('manual_topup_attempt', id)).toEqual([
      { status: 'processing', stripe_payment_intent_id: 'pi_auto_default' },
    ]);
    await expect(buyManually(id, 1000, 'manual_recorded')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  test('a retry past the Stripe key window by the database clock looks the payment up and never charges', async () => {
    const id = await seedWorkspace();
    await db.execute(sql`insert into manual_topup_attempt (workspace_id, attempt_key, credits, created_at)
      values (${id}, ${'00000000-0000-4000-8000-000000000001'}, 400, now() - interval '25 hours')`);
    // An app clock a day behind must not reopen the window.
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() - 24 * 60 * 60 * 1000 });
    try {
      expect(await buyManually(id, 400, '00000000-0000-4000-8000-000000000001')).toEqual({
        outcome: 'expired',
      });
    } finally {
      vi.useRealTimers();
    }
    expect(stripeNetwork.createIntent).not.toHaveBeenCalled();
    expect(stripeNetwork.createCheckout).not.toHaveBeenCalled();
    expect(stripeNetwork.listIntents).toHaveBeenCalled();
    const { rows } = await db.execute(
      sql`select status from manual_topup_attempt where workspace_id = ${id}`,
    );
    expect(rows).toEqual([{ status: 'expired' }]);
  });

  // Stripe's idempotent-replayed header tells a fresh charge from a repeat of an earlier one.
  test.each([
    ['charged', false],
    ['already_charged', true],
  ])('a purchase the webhook granted first is reported to the buyer as %s', async (outcome, replayed) => {
    const id = await seedWorkspace();
    const { grantTopupAndResume } = await import('@/features/billing/api/grant-topup');
    await grantTopupAndResume('pi_webhook_first', { customerId: 'cus_default', credits: 400 });
    stripeNetwork.createIntent.mockResolvedValue({
      id: 'pi_webhook_first',
      status: 'succeeded',
      lastResponse: { headers: replayed ? { 'idempotent-replayed': 'true' } : {} },
    });
    expect((await buyManually(id, 400, 'webhook-first')).outcome).toBe(outcome);
  });
});

describe('automatic top-ups charge once', () => {
  test('an attempt older than the Stripe key window is superseded and never charged again', async () => {
    const id = await seedWorkspace({ enabled: true });
    await db.execute(sql`insert into auto_topup_attempt (workspace_id, status, credits, amount_cents, payment_method_id, created_at)
      values (${id}, 'charging', 400, 2000, 'pm_original', now() - interval '25 hours')`);
    await finishPendingAutoTopup(id);
    expect(stripeNetwork.createIntent).not.toHaveBeenCalled();
    expect(stripeNetwork.listIntents).toHaveBeenCalled();
    const { rows } = await db.execute(
      sql`select status from auto_topup_attempt where workspace_id = ${id}`,
    );
    expect(rows).toEqual([{ status: 'superseded' }]);
  });

  test('a pending payment is still followed up while auto top-up is off and after a failure', async () => {
    const id = await seedWorkspace();
    await db.execute(sql`insert into auto_topup_attempt (workspace_id, status, credits, amount_cents, stripe_payment_intent_id)
      values (${id}, 'failed', 400, 2000, null), (${id}, 'pending', 400, 2000, 'pi_pending')`);
    stripeNetwork.retrieveIntent.mockResolvedValue({
      id: 'pi_pending',
      status: 'processing',
      lastResponse: { headers: {} },
    });
    await finishPendingAutoTopup(id);
    expect(stripeNetwork.retrieveIntent).toHaveBeenCalledWith('pi_pending');
    expect(stripeNetwork.createIntent).not.toHaveBeenCalled();
  });

  test('a frozen attempt cannot charge after auto top-up is switched off', async () => {
    const id = await seedWorkspace();
    await db.execute(sql`insert into auto_topup_attempt (workspace_id, status, credits, amount_cents, payment_method_id)
      values (${id}, 'charging', 1000, 2000, 'pm_frozen')`);
    await maybeAutoTopup(id);
    expect(stripeNetwork.listIntents).not.toHaveBeenCalled();
    await finishPendingAutoTopup(id);
    expect(stripeNetwork.createIntent).not.toHaveBeenCalled();
    expect(stripeNetwork.listIntents).toHaveBeenCalledOnce();
    const { rows } = await db.execute(
      sql`select status from auto_topup_attempt where workspace_id = ${id}`,
    );
    expect(rows).toEqual([{ status: 'charging' }]);
  });

  test('a frozen attempt switched off adopts the charge Stripe already started instead of charging again', async () => {
    const id = await seedWorkspace();
    const attemptId = randomUUID();
    await db.execute(sql`insert into auto_topup_attempt (id, workspace_id, status, credits, amount_cents, payment_method_id)
      values (${attemptId}, ${id}, 'charging', 1000, 2000, 'pm_frozen')`);
    stripeNetwork.listIntents.mockImplementation(async function* () {
      yield {
        id: 'pi_progress',
        status: 'processing',
        metadata: { auto_topup_attempt_id: attemptId },
      };
    });
    await finishPendingAutoTopup(id);
    expect(stripeNetwork.createIntent).not.toHaveBeenCalled();
    expect(await attemptRows('auto_topup_attempt', id)).toEqual([
      { status: 'pending', stripe_payment_intent_id: 'pi_progress' },
    ]);
  });

  test('usage settlement makes no Stripe call while an automatic payment is open', async () => {
    const id = await seedWorkspace({ enabled: true, armed: true });
    await db.execute(sql`insert into auto_topup_attempt (workspace_id, status, credits, amount_cents, payment_method_id, stripe_payment_intent_id)
      values (${id}, 'pending', 400, 2000, 'pm_subscription', 'pi_open')`);
    await maybeAutoTopup(id);
    for (const call of Object.values(stripeNetwork)) expect(call).not.toHaveBeenCalled();
  });

  test('a Stripe outage while starting a payment keeps the attempt open for the sweep, with the same card', async () => {
    const id = await seedWorkspace({ enabled: true, armed: true });
    stripeNetwork.createIntent.mockRejectedValue(new Error('Stripe is down'));
    await expect(maybeAutoTopup(id)).resolves.toBeUndefined();
    const { rows } = await db.execute(
      sql`select status, payment_method_id from auto_topup_attempt where workspace_id = ${id}`,
    );
    expect(rows).toEqual([{ status: 'charging', payment_method_id: 'pm_subscription' }]);
  });
});
